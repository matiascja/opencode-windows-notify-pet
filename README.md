# OpenCode Windows Notify Pet

A Windows-only OpenCode plugin that tells you when an agent needs your attention.

It can:

- show a Windows toast when a top-level session finishes;
- flash the Visual Studio Code taskbar button until the window is focused;
- show an optional animated desktop pet with session context;
- notify when OpenCode is waiting for a question or permission response;
- ignore subagent sessions to avoid notification noise.

## Requirements

- Windows 10 or later
- OpenCode
- Visual Studio Code
- Windows PowerShell 5.1

## Install

Clone the repository and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -EnablePet
```

The installer copies the plugin to `~/.config/opencode/plugins` and enables the
desktop pet for the current user. Restart OpenCode after installation.

To install toast and taskbar notifications without the pet:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Restart OpenCode after uninstalling.

## Configuration

The desktop pet is enabled when `NOTIFY_VSCODE_PET` equals `1`. The installer
stores this as a user environment variable when `-EnablePet` is provided.

```powershell
[Environment]::SetEnvironmentVariable("NOTIFY_VSCODE_PET", "1", "User")
```

Disable it while keeping toast and taskbar notifications:

```powershell
[Environment]::SetEnvironmentVariable("NOTIFY_VSCODE_PET", $null, "User")
```

OpenCode reads plugins and environment variables at startup, so restart it
after changing the installation or configuration.

## How It Works

`notify-vscode.ts` listens to OpenCode events. On `session.idle`, it resolves
the session title and latest user prompt, then starts the notification actions
without blocking the agent. Question and permission events use the same path
with a short per-session debounce.

The desktop pet is rendered by `pet-notify.ps1` using a small layered WinForms
window. `PetLayeredWindow.dll` is an optional precompiled optimization; the
script compiles `PetLayeredWindow.cs` at runtime if the DLL is unavailable.
If you edit the C# source, rebuild the DLL with Windows PowerShell 5.1:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\plugin\notify-vscode\build-pet-dll.ps1
```

## Asset Notice

This repository is private because the current pet sprites depict third-party
characters and their redistribution rights have not been verified. The MIT
license applies to the source code only, not to images or character artwork in
`plugin/notify-vscode/assets/pets` or to third-party product icons.

Do not make this repository public or redistribute those assets until every
asset has a documented, compatible license or has been replaced with original
or freely licensed artwork.

## License

Source code is licensed under the MIT License. See `LICENSE` and
`THIRD_PARTY_ASSETS.md`.
