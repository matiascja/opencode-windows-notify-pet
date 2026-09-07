[CmdletBinding()]
param(
    [switch]$KeepPetEnvironmentVariable,
    [string]$InstallRoot = (Join-Path $HOME ".config\opencode\plugins")
)

$ErrorActionPreference = "Stop"

$pluginRoot = $InstallRoot
$targetEntry = Join-Path $pluginRoot "notify-vscode.ts"
$targetRuntime = Join-Path $pluginRoot "notify-vscode"

if (Test-Path -LiteralPath $targetEntry) {
    Remove-Item -LiteralPath $targetEntry -Force
}
if (Test-Path -LiteralPath $targetRuntime) {
    Remove-Item -LiteralPath $targetRuntime -Recurse -Force
}

if (-not $KeepPetEnvironmentVariable) {
    [Environment]::SetEnvironmentVariable("NOTIFY_VSCODE_PET", $null, "User")
    Remove-Item Env:NOTIFY_VSCODE_PET -ErrorAction SilentlyContinue
}

Write-Output "Uninstalled OpenCode Windows Notify Pet."
Write-Output "Restart OpenCode to unload the plugin."
