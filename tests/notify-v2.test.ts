import { afterEach, expect, test } from "bun:test"
import plugin, { setupNotifyV2 } from "../plugin/notify-vscode"

afterEach(() => { Bun.spawn = originalSpawn })
const originalSpawn = Bun.spawn

test("exports V1 and V2 entrypoints", () => {
  expect(plugin.id).toBe("notify-vscode")
  expect(typeof plugin.setup).toBe("function")
  expect(typeof plugin.server).toBe("function")
})

test("translates V2 events, filters locations/subagents and deduplicates idle", async () => {
  const commands: string[][] = []
  Bun.spawn = ((args: string[]) => {
    commands.push(args)
    return { exited: Promise.resolve(0), stderr: new ReadableStream({ start(c) { c.close() } }) }
  }) as typeof Bun.spawn
  const location = { directory: "C:\\project" }
  const status = (sessionID: string, type: string) => ({ type: "session.status", data: { sessionID, status: { type } } })
  const events = [
    status("main", "busy"), status("main", "idle"),
    { type: "session.idle", data: { sessionID: "main" } },
    status("child", "idle"),
    { ...status("elsewhere", "idle"), location: { directory: "C:\\other" } },
    status("unscoped-other", "idle"),
    { type: "form.created", data: { form: { sessionID: "main" } } },
    { type: "permission.asked", data: { sessionID: "main" } },
    status("main", "busy"), status("main", "idle"),
  ]
  let signal: AbortSignal | undefined
  const cleanup = await setupNotifyV2({
    location,
    session: {
      get: async ({ sessionID }) => ({
        id: sessionID, title: "Test session", parentID: sessionID === "child" ? "main" : undefined,
        location: sessionID === "unscoped-other" ? { directory: "C:\\other" } : location,
      }),
      context: async () => [{ type: "user", text: "Latest prompt" }],
    },
    event: { subscribe: async function* (input) {
      signal = input.signal
      for (const event of events) yield event
    } },
  })
  // Allow the finite event stream to finish without invoking real PowerShell.
  await new Promise(resolve => setTimeout(resolve, 50))
  await cleanup()
  expect(signal?.aborted).toBe(true)
  if (process.platform !== "win32") return
  // Two completion notifications and one waiting notification, each toast+flash.
  expect(commands.filter(args => args.includes("-Command"))).toHaveLength(6)
  expect(commands.some(args => args.join(" ").includes("Latest prompt"))).toBe(true)
})
