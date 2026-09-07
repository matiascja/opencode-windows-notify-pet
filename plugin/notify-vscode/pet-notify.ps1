# pet-notify.ps1
#
# Shows a small desktop pet (with real per-pixel alpha transparency, no
# color-key halo) in the bottom-right corner of the primary screen, along
# with a comic-style speech bubble above it, then closes both after
# -DurationMs milliseconds.
#
# Invoked by notify-vscode.ts via `powershell -File pet-notify.ps1 <PetId> <Message> <DurationMs>`.
# Arguments are passed as separate process argv entries (not interpolated
# into script text), so there is no quoting/injection concern here even
# if the message contains quotes, backticks, or other PowerShell-special
# characters.

param(
    [Parameter(Mandatory = $true)][string]$PetId,
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$DurationMs = 3500
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Load the PetLayeredWindow type. Prefer the precompiled DLL (near-instant)
# and fall back to compiling the C# source inline if the DLL is missing
# (e.g. build-pet-dll.ps1 was never run). Compiling inline costs ~1.2s, so
# the DLL path is the fast path we want on every real notification.
$petDll = Join-Path $PSScriptRoot "assets\PetLayeredWindow.dll"
$petSrc = Join-Path $PSScriptRoot "assets\PetLayeredWindow.cs"

if (Test-Path -LiteralPath $petDll) {
    Add-Type -Path $petDll
} else {
    Add-Type -TypeDefinition (Get-Content -LiteralPath $petSrc -Raw) `
        -ReferencedAssemblies System.Windows.Forms, System.Drawing
}

# Draws a comic-style speech bubble (rounded rect + tail pointing down at
# the pet) with real alpha, returns a Bitmap. Text wraps automatically
# within the bubble bounds via DrawString + a bounding RectangleF.
function New-SpeechBubble {
    param(
        [string]$Text,
        [int]$Width = 280,
        [int]$Height = 90,
        [int]$TailX = 230
    )

    $bmp = New-Object System.Drawing.Bitmap $Width, ($Height + 16)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

    $bodyRect = New-Object System.Drawing.Rectangle 0, 0, ($Width - 1), ($Height - 1)
    $radius = 16
    $d = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($bodyRect.X, $bodyRect.Y, $d, $d, 180, 90)
    $path.AddArc($bodyRect.Right - $d, $bodyRect.Y, $d, $d, 270, 90)
    $path.AddArc($bodyRect.Right - $d, $bodyRect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($bodyRect.X, $bodyRect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $tailPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tailPath.AddPolygon(@(
        (New-Object System.Drawing.Point ($TailX - 10), ($Height - 2)),
        (New-Object System.Drawing.Point ($TailX + 10), ($Height - 2)),
        (New-Object System.Drawing.Point $TailX, ($Height + 14))
    ))

    $fillBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 90, 90, 90)), 2

    $g.FillPath($fillBrush, $path)
    $g.FillPath($fillBrush, $tailPath)
    $g.DrawPath($borderPen, $path)
    $g.DrawPath($borderPen, $tailPath)

    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $font = New-Object System.Drawing.Font("Segoe UI", 10)
    $textRect = New-Object System.Drawing.RectangleF 10, 6, ($Width - 20), ($Height - 12)
    $g.DrawString($Text, $font, [System.Drawing.Brushes]::Black, $textRect, $sf)

    $g.Dispose()
    return $bmp
}

function Resize-Bitmap {
    param($Source, [int]$Width, [int]$Height)
    $dst = New-Object System.Drawing.Bitmap $Width, $Height
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.DrawImage($Source, 0, 0, $Width, $Height)
    $g.Dispose()
    return $dst
}

try {
    $petsDir = Join-Path $PSScriptRoot "assets\pets"
    $frameDir = Join-Path $petsDir $PetId

    if (-not (Test-Path -LiteralPath $frameDir)) {
        Write-Error "Pet not found: $PetId (expected at $frameDir)"
        exit 1
    }

    $frameFiles = Get-ChildItem -LiteralPath $frameDir -Filter "frame_*.png" | Sort-Object Name
    if ($frameFiles.Count -eq 0) {
        Write-Error "No animation frames found for pet: $PetId"
        exit 1
    }

    $rawFrames = $frameFiles | ForEach-Object { [System.Drawing.Bitmap]::new($_.FullName) }

    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $spriteW = 120
    $spriteH = 130
    $margin = 30

    $scaledFrames = $rawFrames | ForEach-Object { Resize-Bitmap -Source $_ -Width $spriteW -Height $spriteH }

    $petForm = New-Object PetLayeredWindow
    $petForm.FormBorderStyle = "None"
    $petForm.TopMost = $true
    $petForm.ShowInTaskbar = $false
    $petForm.StartPosition = "Manual"
    $petForm.Size = New-Object System.Drawing.Size($spriteW, $spriteH)
    $petX = $screen.Width - $spriteW - $margin
    $petY = $screen.Height - $spriteH - $margin
    $petForm.Location = New-Object System.Drawing.Point($petX, $petY)

    $bubbleWidth = 280
    $bubbleHeight = 90
    $bubbleBmp = New-SpeechBubble -Text $Message -Width $bubbleWidth -Height $bubbleHeight -TailX ($bubbleWidth - 50)

    $bubbleForm = New-Object PetLayeredWindow
    $bubbleForm.FormBorderStyle = "None"
    $bubbleForm.TopMost = $true
    $bubbleForm.ShowInTaskbar = $false
    $bubbleForm.StartPosition = "Manual"
    $bubbleForm.Size = New-Object System.Drawing.Size $bubbleBmp.Width, $bubbleBmp.Height
    $bubbleX = $petX + ($spriteW / 2) - ($bubbleWidth - 50)
    $bubbleY = $petY - $bubbleBmp.Height + 4
    $bubbleForm.Location = New-Object System.Drawing.Point ([int]$bubbleX), ([int]$bubbleY)

    $petForm.Show()
    $petForm.SetBitmap($scaledFrames[0])
    $bubbleForm.Show()
    $bubbleForm.SetBitmap($bubbleBmp)

    $tickMs = 30
    $elapsed = 0
    $frameIntervalMs = 200
    $frameElapsed = 0
    $frameIndex = 0

    while ($elapsed -lt $DurationMs) {
        Start-Sleep -Milliseconds $tickMs
        $elapsed += $tickMs
        $frameElapsed += $tickMs
        if ($frameElapsed -ge $frameIntervalMs) {
            $frameElapsed = 0
            $frameIndex = ($frameIndex + 1) % $scaledFrames.Count
            $petForm.SetBitmap($scaledFrames[$frameIndex])
        }
        [System.Windows.Forms.Application]::DoEvents()
    }

    $petForm.Close()
    $bubbleForm.Close()
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
