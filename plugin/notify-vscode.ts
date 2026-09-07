/**
 * notify-vscode
 *
 * Windows-only plugin that makes it obvious when OpenCode finishes
 * responding and is waiting on you again, even if VS Code is minimized
 * or you're focused on another window.
 *
 * Fires on `session.idle` (the agent finished its turn) and does up to
 * three things:
 *   1. Shows a Windows toast notification (title + last user prompt).
 *   2. Flashes the VS Code taskbar icon until you focus the window.
 *   3. (Opt-in) Shows a small desktop pet in the bottom-right corner with
 *      a comic-style speech bubble — a random pet + catchphrase from
 *      assets/pets/manifest.json, combined with the real session context.
 *
 * The pet is off by default. Enable it by setting the environment
 * variable NOTIFY_VSCODE_PET=1 (e.g. in your shell profile or in
 * opencode's env config) — it's purely cosmetic and easy to toggle off
 * again if it gets annoying.
 *
 * Pet notifications are queued (not run in parallel): if a second
 * session.idle fires while a pet is still showing, it waits its turn
 * instead of overlapping visually in the same screen corner. Toast and
 * taskbar-flash are NOT queued — those fire immediately every time,
 * since they don't share screen space.
 *
 * Sub-agent sessions (created via Task()) are skipped — otherwise every
 * internal orchestrator/sub-agent turn would also trigger a notification.
 *
 * All actions are fire-and-forget: failures are logged but never throw,
 * so a broken PowerShell/toast environment can't break OpenCode.
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "path"

// ─── Configuration ───────────────────────────────────────────────────────────

// AppID VS Code registers with Windows — reusing it means the toast shows
// the VS Code icon and groups correctly in the Action Center.
const TOAST_APP_ID = "Microsoft.VisualStudioCode"

// OpenCode's own icon, copied from the VS Code extension's bundled assets.
const RUNTIME_ROOT = path.join(import.meta.dir, "notify-vscode")
const TOAST_ICON_PATH = path.join(RUNTIME_ROOT, "assets", "opencode-icon.png")

const MAX_PROMPT_PREVIEW = 120

// Opt-in: the desktop pet is cosmetic and off by default. Toggle with
// NOTIFY_VSCODE_PET=1 in the environment opencode runs in.
const PET_ENABLED = process.env.NOTIFY_VSCODE_PET === "1"
const PET_DURATION_MS = 3500
const PET_SCRIPT_PATH = path.join(RUNTIME_ROOT, "pet-notify.ps1")
const PET_MANIFEST_PATH = path.join(RUNTIME_ROOT, "assets", "pets", "manifest.json")

// Bubble text is much smaller than the toast — keep the combined
// catchphrase + context short enough to fit 2-3 lines comfortably.
const MAX_BUBBLE_CONTEXT = 60

type PetManifestEntry = {
  displayName: string
  phrases: string[]
}

export const NotifyVscodePlugin: Plugin = async ({ client }) => {
  // Structured logging via client.app.log() — shows up in OpenCode's own
  // log file (~/.local/share/opencode/log/opencode.log) so we can verify
  // the plugin loaded and the hook actually fired, not just when it fails.
  async function log(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) {
    try {
      await client.app.log({ body: { service: "notify-vscode", level, message, extra } })
    } catch {
      // If app.log itself is unavailable, fall back to console so we still
      // have *some* trace, even if it doesn't land in the structured log.
      console.error(`[notify-vscode] ${message}`, extra ?? "")
    }
  }

  await log("info", "plugin loaded", { platform: process.platform })

  // Only makes sense on Windows (toast + taskbar flash are Win32-specific).
  if (process.platform !== "win32") {
    await log("info", "skipping: not win32")
    return {}
  }

  // Sessions we've identified as sub-agents (Task() calls). Mirrors the
  // detection heuristic used in plugins/engram.ts so both plugins agree
  // on what counts as a "real" top-level session.
  const subAgentSessions = new Set<string>()

  function isSubAgentTitle(title: string | undefined) {
    return !!title && title.endsWith(" subagent)")
  }

  async function runPowerShell(script: string) {
    try {
      const proc = Bun.spawn(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { stdout: "ignore", stderr: "pipe", stdin: "ignore" },
      )
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        console.error("[notify-vscode] PowerShell exited non-zero:", stderr.trim())
      }
    } catch (err) {
      console.error("[notify-vscode] failed to spawn PowerShell:", err)
    }
  }

  // Escapes a string for safe interpolation inside a PowerShell single-quoted
  // literal (doubling embedded single quotes is PowerShell's own escape rule).
  function psQuote(value: string) {
    return value.replace(/'/g, "''")
  }

  async function showToast(title: string, body: string) {
    const safeTitle = psQuote(title)
    const safeBody = psQuote(body)
    const safeIcon = psQuote(TOAST_ICON_PATH)

    const script = `
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $iconPath = '${safeIcon}'
  $hasIcon = Test-Path -LiteralPath $iconPath

  $imageXml = ''
  if ($hasIcon) {
    $imageXml = "<image placement='appLogoOverride' hint-crop='circle' src='file:///$iconPath' />"
  }

  $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      $imageXml
      <text>${safeTitle}</text>
      <text>${safeBody}</text>
    </binding>
  </visual>
</toast>
"@

  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($template)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_APP_ID}')
  $notifier.Show($toast)
} catch {
  Write-Error $_.Exception.Message
}
`.trim()

    await runPowerShell(script)
  }

  // Lazily loaded once and cached — the manifest doesn't change at runtime.
  let petManifest: Record<string, PetManifestEntry> | null = null
  let petIds: string[] = []

  async function loadPetManifest() {
    if (petManifest) return petManifest
    try {
      const text = await Bun.file(PET_MANIFEST_PATH).text()
      petManifest = JSON.parse(text) as Record<string, PetManifestEntry>
      petIds = Object.keys(petManifest)
    } catch (err) {
      await log("error", "failed to load pet manifest", { error: String(err) })
      petManifest = {}
      petIds = []
    }
    return petManifest
  }

  function pickRandom<T>(items: T[]): T | undefined {
    if (items.length === 0) return undefined
    return items[Math.floor(Math.random() * items.length)]
  }

  // Serializes pet notifications so overlapping session.idle events don't
  // draw two pets in the same screen corner at once. Toast and taskbar
  // flash are intentionally NOT part of this queue — they don't share
  // screen space, so there's no reason to delay them.
  let petQueueTail: Promise<void> = Promise.resolve()

  function enqueuePetNotification(run: () => Promise<void>) {
    petQueueTail = petQueueTail.then(run).catch((err) => {
      log("error", "pet notification failed", { error: String(err) })
    })
    return petQueueTail
  }

  // Two flavors of pet notification:
  //   "done"    → the agent finished its turn (session.idle)
  //   "waiting" → the agent is blocked waiting for YOUR answer to a
  //               question-with-options or a permission prompt.
  // The "waiting" case uses functional, attention-grabbing phrasing (not a
  // random catchphrase) because the point is "come back and answer", not fun.
  type PetNotificationKind = "done" | "waiting"

  // Generic "I need your answer" phrases shared across all pets. Kept short so
  // the pet's displayName + this + the session identifier fit the bubble.
  const WAITING_PHRASES = [
    "¡Necesito tu respuesta!",
    "Estoy esperando que respondas.",
    "Falta tu respuesta para seguir.",
  ]

  async function showPetNotification(kind: PetNotificationKind, sessionTitle: string, contextText: string) {
    const manifest = await loadPetManifest()
    if (!manifest || petIds.length === 0) {
      await log("warn", "no pets available in manifest, skipping pet notification")
      return
    }

    const petId = pickRandom(petIds)!
    const entry = manifest[petId]!

    // Prefer the session title — it's usually a short auto-generated
    // summary (e.g. "Saludo inicial") that identifies the session better
    // than the raw first-message preview, and matches what you'd see in
    // VS Code's session list. Fall back to the prompt preview only when
    // the title is missing or the generic placeholder ("OpenCode").
    const identifier = sessionTitle && sessionTitle !== "OpenCode" ? sessionTitle : contextText

    const trimmedIdentifier =
      identifier.length > MAX_BUBBLE_CONTEXT ? identifier.slice(0, MAX_BUBBLE_CONTEXT) + "…" : identifier

    // "done" → pet catchphrase (fun). "waiting" → urgent functional phrase.
    const lead = kind === "waiting" ? pickRandom(WAITING_PHRASES)! : pickRandom(entry.phrases) ?? entry.displayName

    const message = trimmedIdentifier ? `${lead} — ${trimmedIdentifier}` : lead

    await log("info", "showing pet notification", { kind, petId, message })

    try {
      const proc = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          PET_SCRIPT_PATH,
          petId,
          message,
          String(PET_DURATION_MS),
        ],
        { stdout: "ignore", stderr: "pipe", stdin: "ignore" },
      )
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        await log("error", "pet-notify.ps1 exited non-zero", { petId, stderr: stderr.trim() })
      }
    } catch (err) {
      await log("error", "failed to spawn pet-notify.ps1", { petId, error: String(err) })
    }
  }

  async function flashVscodeTaskbar() {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
}

public class NotifyVscodeFlasher {
    [DllImport("user32.dll")]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    // FLASHW_ALL: flash both the taskbar button and the window caption.
    // FLASHW_TIMERNOFG: keep flashing until the window is brought to the
    // foreground (instead of a fixed number of flashes).
    public const uint FLASHW_ALL = 3;
    public const uint FLASHW_TIMERNOFG = 12;

    public static void FlashUntilFocused(IntPtr hwnd) {
        FLASHWINFO fi = new FLASHWINFO();
        fi.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
        fi.hwnd = hwnd;
        fi.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
        fi.uCount = uint.MaxValue;
        fi.dwTimeout = 0;
        FlashWindowEx(ref fi);
    }
}
"@ -ErrorAction SilentlyContinue

try {
  $procs = Get-Process -Name 'Code' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($proc in $procs) {
    [NotifyVscodeFlasher]::FlashUntilFocused($proc.MainWindowHandle)
  }
} catch {
  Write-Error $_.Exception.Message
}
`.trim()

    await runPowerShell(script)
  }

  // Resolves a session's title + a prompt preview for the bubble/toast, and
  // reports whether it's a sub-agent session (which we skip). Shared by the
  // session.idle and question/permission handlers so both notify consistently.
  async function resolveSessionContext(sessionId: string): Promise<{ title: string; body: string; isSubAgent: boolean } | null> {
    try {
      const sessionRes = await client.session.get({ path: { id: sessionId } })
      const session = (sessionRes as any).data ?? sessionRes
      const title: string = session?.title?.trim() || "OpenCode"

      if (isSubAgentTitle(title) || session?.parentID) {
        subAgentSessions.add(sessionId)
        return { title, body: "", isSubAgent: true }
      }

      let promptPreview = ""
      try {
        const messagesRes = await client.session.messages({ path: { id: sessionId }, query: { limit: 20 } })
        const messages: any[] = (messagesRes as any).data ?? messagesRes ?? []

        for (let i = messages.length - 1; i >= 0; i--) {
          const entry = messages[i]
          if (entry?.info?.role !== "user") continue

          const text = (entry.parts ?? [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")
            .join(" ")
            .trim()

          if (text) {
            promptPreview = text.length > MAX_PROMPT_PREVIEW ? text.slice(0, MAX_PROMPT_PREVIEW) + "…" : text
            break
          }
        }
      } catch (err) {
        await log("error", "failed to fetch messages", { sessionId, error: String(err) })
      }

      const body = promptPreview || "Sesión terminada, esperando tu respuesta."
      return { title, body, isSubAgent: false }
    } catch (err) {
      await log("error", "failed to resolve session context", { sessionId, error: String(err) })
      return null
    }
  }

  // Debounce the "waiting" notification per session: OpenCode may emit the
  // underlying event more than once (create + state changes), and a single
  // agent turn can ask for several permissions in a row. We only want ONE
  // "come answer" nudge per short window per session.
  const lastWaitingNudge = new Map<string, number>()
  const WAITING_DEBOUNCE_MS = 8000

  async function handleWaitingEvent(sessionId: string | undefined, reason: string) {
    if (!sessionId || subAgentSessions.has(sessionId)) return

    const now = Date.now()
    const prev = lastWaitingNudge.get(sessionId) ?? 0
    if (now - prev < WAITING_DEBOUNCE_MS) {
      await log("info", "skipping waiting nudge (debounced)", { sessionId, reason })
      return
    }
    lastWaitingNudge.set(sessionId, now)

    await log("info", "waiting event received", { sessionId, reason })

    const ctx = await resolveSessionContext(sessionId)
    if (!ctx || ctx.isSubAgent) return

    const immediateActions = [
      showToast(ctx.title, "Necesita tu respuesta para continuar."),
      flashVscodeTaskbar(),
    ]
    if (PET_ENABLED) {
      enqueuePetNotification(() => showPetNotification("waiting", ctx.title, ctx.body))
    }
    await Promise.all(immediateActions)
  }

  return {
    event: async ({ event }) => {
      // Track sub-agent sessions from session.created so we can skip them
      // when session.idle fires later. Same heuristic as engram.ts:
      // parentID set, or title ending in " subagent)".
      if (event.type === "session.created") {
        const info = (event.properties as any)?.info
        const sessionId: string | undefined = info?.id
        const parentID: string | undefined = info?.parentID
        const title: string | undefined = info?.title

        if (sessionId && (!!parentID || isSubAgentTitle(title))) {
          subAgentSessions.add(sessionId)
        }
      }

      if (event.type === "session.deleted") {
        const info = (event.properties as any)?.info
        const sessionId: string | undefined = info?.id
        if (sessionId) {
          subAgentSessions.delete(sessionId)
          lastWaitingNudge.delete(sessionId)
        }
      }

      // --- Agent is blocked waiting for the user's answer ---
      // We handle several possible event names defensively because the exact
      // one emitted to plugins depends on OpenCode's SDK version (v1 vs v2):
      //   - question.asked / question.v2.asked → question-with-options
      //   - permission.updated / permission.asked → permission prompt
      // Treating properties as `any` keeps this working regardless of which
      // shape actually arrives. The "*.replied"/"*.rejected" variants are
      // intentionally NOT handled — those mean the user already answered.
      const waitingEventTypes = new Set([
        "question.asked",
        "question.v2.asked",
        "permission.updated",
        "permission.asked",
      ])
      if (waitingEventTypes.has(event.type as string)) {
        const props = (event.properties as any) ?? {}
        const sessionId: string | undefined = props.sessionID ?? props.info?.sessionID
        await handleWaitingEvent(sessionId, event.type as string)
        return
      }

      if (event.type !== "session.idle") return

      const sessionId = (event.properties as any)?.sessionID as string | undefined
      await log("info", "session.idle received", { sessionId })

      if (!sessionId || subAgentSessions.has(sessionId)) {
        await log("info", "skipping session.idle: no id or known sub-agent", { sessionId })
        return
      }

      const ctx = await resolveSessionContext(sessionId)
      if (!ctx) return
      if (ctx.isSubAgent) {
        await log("info", "skipping session.idle: detected as sub-agent", { sessionId, title: ctx.title })
        return
      }

      await log("info", "firing notifications", { sessionId, title: ctx.title, body: ctx.body, pet: PET_ENABLED })

      // Toast + taskbar flash fire immediately and in parallel — they
      // don't share screen space, so there's no need to serialize them.
      const immediateActions = [showToast(ctx.title, ctx.body), flashVscodeTaskbar()]

      // Pet notification is queued separately (see enqueuePetNotification)
      // so it never overlaps with another pet still on screen.
      if (PET_ENABLED) {
        enqueuePetNotification(() => showPetNotification("done", ctx.title, ctx.body))
      }

      await Promise.all(immediateActions)
    },
  }
}

export default NotifyVscodePlugin
