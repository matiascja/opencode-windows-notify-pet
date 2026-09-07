// PetLayeredWindow.cs
//
// Precompiled to PetLayeredWindow.dll via build-pet-dll.ps1 so pet-notify.ps1
// can load it with Add-Type -Path (near-instant) instead of compiling this
// source at every invocation (which cost ~1.2s of runtime C# compilation).
//
// A Form subclass that renders via UpdateLayeredWindow with real per-pixel
// alpha, instead of TransparencyKey (color-key transparency). Color-key
// transparency mangles anti-aliased edges into a visible halo around the
// sprite; per-pixel alpha respects the PNG's actual alpha channel.

using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Windows.Forms;

public class PetLayeredWindow : Form {
    [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
    static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll", ExactSpelling = true)]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll", ExactSpelling = true)]
    static extern IntPtr SelectObject(IntPtr hdc, IntPtr bmp);
    [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool DeleteObject(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int x; public int y; public POINT(int x, int y) { this.x = x; this.y = y; } }
    [StructLayout(LayoutKind.Sequential)]
    struct SIZE { public int cx; public int cy; public SIZE(int cx, int cy) { this.cx = cx; this.cy = cy; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct BLENDFUNCTION { public byte BlendOp; public byte BlendFlags; public byte SourceConstantAlpha; public byte AlphaFormat; }

    const int WS_EX_LAYERED = 0x80000;
    const int ULW_ALPHA = 2;
    const byte AC_SRC_OVER = 0;
    const byte AC_SRC_ALPHA = 1;

    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED; return cp; }
    }

    public void SetBitmap(Bitmap bitmap) {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr hBitmap = IntPtr.Zero;
        IntPtr oldBitmap = IntPtr.Zero;
        try {
            hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
            oldBitmap = SelectObject(memDc, hBitmap);
            SIZE size = new SIZE(bitmap.Width, bitmap.Height);
            POINT pointSource = new POINT(0, 0);
            POINT topPos = new POINT(this.Left, this.Top);
            BLENDFUNCTION blend = new BLENDFUNCTION();
            blend.BlendOp = AC_SRC_OVER;
            blend.BlendFlags = 0;
            blend.SourceConstantAlpha = 255;
            blend.AlphaFormat = AC_SRC_ALPHA;
            UpdateLayeredWindow(this.Handle, screenDc, ref topPos, ref size, memDc, ref pointSource, 0, ref blend, ULW_ALPHA);
        } finally {
            ReleaseDC(IntPtr.Zero, screenDc);
            if (hBitmap != IntPtr.Zero) { SelectObject(memDc, oldBitmap); DeleteObject(hBitmap); }
            DeleteDC(memDc);
        }
    }
}
