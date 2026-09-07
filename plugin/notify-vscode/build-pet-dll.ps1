# build-pet-dll.ps1
#
# Compiles PetLayeredWindow.cs into PetLayeredWindow.dll so pet-notify.ps1
# can load it via Add-Type -Path (near-instant) instead of compiling C#
# source on every invocation (~1.2s savings per pet notification).
#
# Run this once after editing PetLayeredWindow.cs. pet-notify.ps1 falls
# back to compiling the inline source if the DLL is missing, so this is
# an optimization, not a hard dependency.

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -ne "Desktop") {
    throw "Run this script with Windows PowerShell 5.1 (powershell.exe), not PowerShell 7."
}

$here = $PSScriptRoot
$srcPath = Join-Path $here "assets\PetLayeredWindow.cs"
$dllPath = Join-Path $here "assets\PetLayeredWindow.dll"

if (Test-Path -LiteralPath $dllPath) {
    Remove-Item -LiteralPath $dllPath -Force
}

Add-Type -TypeDefinition (Get-Content -LiteralPath $srcPath -Raw) `
    -ReferencedAssemblies System.Windows.Forms, System.Drawing `
    -OutputAssembly $dllPath `
    -OutputType Library

if (Test-Path -LiteralPath $dllPath) {
    Write-Output "Built: $dllPath ($((Get-Item $dllPath).Length) bytes)"
} else {
    Write-Error "Build failed: $dllPath was not produced"
    exit 1
}
