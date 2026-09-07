[CmdletBinding()]
param(
    [switch]$EnablePet,
    [string]$InstallRoot = (Join-Path $HOME ".config\opencode\plugins")
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "This plugin supports Windows only."
}

$sourceRoot = Join-Path $PSScriptRoot "plugin"
$sourceEntry = Join-Path $sourceRoot "notify-vscode.ts"
$sourceRuntime = Join-Path $sourceRoot "notify-vscode"
$pluginRoot = $InstallRoot
$targetEntry = Join-Path $pluginRoot "notify-vscode.ts"
$targetRuntime = Join-Path $pluginRoot "notify-vscode"

if (-not (Test-Path -LiteralPath $sourceEntry)) {
    throw "Plugin entry point not found: $sourceEntry"
}
if (-not (Test-Path -LiteralPath $sourceRuntime)) {
    throw "Plugin runtime directory not found: $sourceRuntime"
}

New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null
Copy-Item -LiteralPath $sourceEntry -Destination $targetEntry -Force

if (Test-Path -LiteralPath $targetRuntime) {
    Remove-Item -LiteralPath $targetRuntime -Recurse -Force
}
Copy-Item -LiteralPath $sourceRuntime -Destination $targetRuntime -Recurse -Force

if ($EnablePet) {
    [Environment]::SetEnvironmentVariable("NOTIFY_VSCODE_PET", "1", "User")
    $env:NOTIFY_VSCODE_PET = "1"
}

Write-Output "Installed OpenCode Windows Notify Pet in $pluginRoot"
if ($EnablePet) {
    Write-Output "Desktop pet enabled for the current user."
} else {
    Write-Output "Desktop pet remains opt-in. Re-run with -EnablePet to enable it."
}
Write-Output "Restart OpenCode to load the plugin."
