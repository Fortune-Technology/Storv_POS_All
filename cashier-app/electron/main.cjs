/**
 * Electron Main Process — StoreVeu POS
 * Wraps the Vite/React cashier app in a desktop window.
 * Provides direct access to USB printers, cash drawer, and network printers
 * WITHOUT requiring QZ Tray.
 */

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path   = require('path');
const net    = require('net');
const fs     = require('fs');
const os     = require('os');
const { exec, execFile } = require('child_process');

const isDev = process.env.NODE_ENV === 'development';

// ── Create main window ─────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:           1280,
    height:          800,
    fullscreen:      !isDev,       // kiosk-style in production
    autoHideMenuBar: true,         // hide menu bar in production
    backgroundColor: '#0f1117',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.cjs'),
      contextIsolation:  true,
      nodeIntegration:   false,
      webSecurity:       true,
    },
    icon: path.join(__dirname, '../public/icon.ico'),
  });

  if (isDev) {
    // Load from local Vite dev server (npm run electron:dev starts it on 5174)
    win.loadURL('http://localhost:5174');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Load built app
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ── Register all IPC handlers ────────────────────────────────────────────
  registerPrinterIPC(ipcMain, win);
  registerDrawerIPC(ipcMain);
  registerAppIPC(ipcMain, win);

  // ── Auto-logout on window close ──────────────────────────────────────────
  // When the Electron window is closed (X button, task kill, power off),
  // clear the cashier session from localStorage so on next open the register
  // shows the PIN login screen rather than resuming a stale cashier session.
  // Station config (pos_station) is intentionally left intact.
  win.on('close', async () => {
    try {
      if (!win.webContents.isDestroyed()) {
        await win.webContents.executeJavaScript('localStorage.removeItem("pos_user"); true;');
      }
    } catch {
      // Renderer already destroyed — localStorage is about to be cleared with
      // a fresh session anyway when the app reopens (localStorage persists but
      // the cashier session will be absent if executeJavaScript succeeded above).
    }
  });

  return win;
}

// ── Customer Display — auto-opens on secondary monitor ────────────────────
let customerDisplayWin = null;

function createCustomerDisplay() {
  const displays    = screen.getAllDisplays();
  const primaryId   = screen.getPrimaryDisplay().id;
  const secondary   = displays.find(d => d.id !== primaryId);

  // Only auto-open when a second monitor is connected
  if (!secondary) return null;

  const { x, y, width, height } = secondary.bounds;

  customerDisplayWin = new BrowserWindow({
    x, y, width, height,
    fullscreen:      true,
    frame:           false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c12',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    // Don't show in taskbar — it's a peripheral display, not a user-facing window
    skipTaskbar: true,
  });

  if (isDev) {
    customerDisplayWin.loadURL('http://localhost:5174/#/customer-display');
  } else {
    // For file:// protocol, hash must be appended after loading
    customerDisplayWin.loadFile(
      path.join(__dirname, '../dist/index.html'),
      { hash: '/customer-display' }
    );
  }

  customerDisplayWin.on('closed', () => { customerDisplayWin = null; });

  return customerDisplayWin;
}

app.whenReady().then(() => {
  const mainWin = createWindow();

  // Give the main window a moment to initialize, then open customer display
  mainWin.once('ready-to-show', () => {
    createCustomerDisplay();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ══════════════════════════════════════════════════════════════════════════
// PRINTER HANDLERS
// ══════════════════════════════════════════════════════════════════════════

function registerPrinterIPC(ipcMain, win) {

  // ── List all system printers ─────────────────────────────────────────────
  ipcMain.handle('printer:list', async () => {
    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers.map(p => ({
        name:        p.name,
        displayName: p.displayName || p.name,
        isDefault:   p.isDefault,
        status:      p.status,
      }));
    } catch {
      return [];
    }
  });

  // ── Print raw ESC/POS to NETWORK printer (IP:port) ───────────────────────
  ipcMain.handle('printer:print-network', async (_, { ip, port = 9100, data }) => {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const buf = Buffer.from(data, 'binary');

      socket.setTimeout(8000);
      socket.connect(port, ip, () => {
        socket.write(buf, () => {
          socket.destroy();
          resolve({ success: true });
        });
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error(`Printer timeout at ${ip}:${port}`)); });
      socket.on('error',   (err) => reject(err));
    });
  });

  // ── Print ESC/POS to USB printer (Windows system printer) ────────────────
  // Writes a .ps1 script file (avoids command-line heredoc escaping issues)
  // then executes it with powershell -File, capturing stderr for error details.
  ipcMain.handle('printer:print-usb', async (_, { printerName, data }) => {
    return new Promise((resolve, reject) => {
      const stamp   = Date.now();
      const tmpBin  = path.join(os.tmpdir(), `sv_rcpt_${stamp}.bin`);
      const tmpPs   = path.join(os.tmpdir(), `sv_rcpt_${stamp}.ps1`);

      // 1. Write raw ESC/POS bytes to a temp binary file
      try {
        fs.writeFileSync(tmpBin, Buffer.from(data, 'binary'));
      } catch (e) {
        return reject(new Error('Could not write receipt data: ' + e.message));
      }

      // 2. Escape printer name for PowerShell single-quoted string (double the apostrophes)
      const psSafeName = printerName.replace(/'/g, "''");
      const psSafeBin  = tmpBin.replace(/\\/g, '\\\\');

      // 3. Build the .ps1 script — heredoc works correctly in a file (not on command line)
      //    The Add-Type C# compilation is cached as a .dll to avoid recompiling on every print.
      //    First print: ~2-3s (compile + save). Subsequent prints: ~200ms (load cached dll).
      const psScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$dllPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'sv_rawprint_v2.dll')
if (Test-Path $dllPath) {
  Add-Type -Path $dllPath
} else {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [DllImport("winspool.drv", EntryPoint="OpenPrinterA",   SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", EntryPoint="ClosePrinter",   SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern int StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA d);
    [DllImport("winspool.drv", EntryPoint="EndDocPrinter",  SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", EntryPoint="WritePrinter",   SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@ -OutputAssembly $dllPath
  Add-Type -Path $dllPath
}
$hPrinter = [IntPtr]::Zero
$di = New-Object DOCINFOA
$di.pDocName   = 'StoreVeu Receipt'
$di.pDataType  = 'RAW'
$ok = [RawPrint]::OpenPrinter('${psSafeName}', [ref]$hPrinter, [IntPtr]::Zero)
if (-not $ok) { throw "OpenPrinter failed for '${psSafeName}' - verify name in Windows Devices and Printers" }
try {
  [RawPrint]::StartDocPrinter($hPrinter, 1, $di)  | Out-Null
  [RawPrint]::StartPagePrinter($hPrinter)           | Out-Null
  $bytes = [System.IO.File]::ReadAllBytes('${psSafeBin}')
  $ptr   = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $w = 0
  [RawPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$w) | Out-Null
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  [RawPrint]::EndPagePrinter($hPrinter)  | Out-Null
  [RawPrint]::EndDocPrinter($hPrinter)   | Out-Null
} finally {
  [RawPrint]::ClosePrinter($hPrinter)    | Out-Null
  Remove-Item '${psSafeBin}' -ErrorAction SilentlyContinue
}
`.trimStart();

      // 4. Write the .ps1 script to a temp file.
      //    Prepend UTF-8 BOM (\uFEFF) so PowerShell reads as UTF-8 on any Windows locale.
      try {
        fs.writeFileSync(tmpPs, '\uFEFF' + psScript, 'utf8');
      } catch (e) {
        try { fs.unlinkSync(tmpBin); } catch {}
        return reject(new Error('Could not write print script: ' + e.message));
      }

      // 5. Execute the script with -File (not -Command) so heredoc works correctly
      exec(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpPs}"`,
        { timeout: 15000 },
        (err, _stdout, stderr) => {
          try { fs.unlinkSync(tmpBin); } catch {}
          try { fs.unlinkSync(tmpPs);  } catch {}
          if (err) {
            const detail = stderr?.trim() || err.message;
            reject(new Error('USB print failed: ' + detail));
          } else {
            resolve({ success: true });
          }
        }
      );
    });
  });

  // ── Print label ZPL to network label printer ─────────────────────────────
  ipcMain.handle('printer:print-label-network', async (_, { ip, port = 9100, zpl }) => {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(8000);
      socket.connect(port, ip, () => {
        socket.write(Buffer.from(zpl, 'utf8'), () => {
          socket.destroy();
          resolve({ success: true });
        });
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Label printer timeout')); });
      socket.on('error',   (err) => reject(err));
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// CASH DRAWER HANDLERS
// ══════════════════════════════════════════════════════════════════════════

function registerDrawerIPC(ipcMain) {

  // ESC/POS drawer kick command bytes
  const DRAWER_KICK = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);

  // ── Open drawer via network printer ─────────────────────────────────────
  ipcMain.handle('drawer:open-network', async (_, { ip, port = 9100 }) => {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(port, ip, () => {
        socket.write(DRAWER_KICK, () => {
          socket.destroy();
          resolve({ success: true });
        });
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Drawer kick timeout')); });
      socket.on('error',   (err) => reject(err));
    });
  });

  // ── Open drawer via USB printer (Windows) ───────────────────────────────
  ipcMain.handle('drawer:open-usb', async (_, { printerName }) => {
    return new Promise((resolve, reject) => {
      const stamp  = Date.now();
      const tmpBin = path.join(os.tmpdir(), `sv_drawer_${stamp}.bin`);
      const tmpPs  = path.join(os.tmpdir(), `sv_drawer_${stamp}.ps1`);

      fs.writeFileSync(tmpBin, DRAWER_KICK);

      const psSafeName = printerName.replace(/'/g, "''");
      const psSafeBin  = tmpBin.replace(/\\/g, '\\\\');

      const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class DP2 {
  [DllImport("winspool.drv",EntryPoint="OpenPrinterA",  SetLastError=true,CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
  [DllImport("winspool.drv",EntryPoint="ClosePrinter",  SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",EntryPoint="StartDocPrinterA",SetLastError=true,CharSet=CharSet.Ansi)]
  public static extern int StartDoc(IntPtr h,int l,[In,MarshalAs(UnmanagedType.LPStruct)] DI2 d);
  [DllImport("winspool.drv",EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDoc(IntPtr h);
  [DllImport("winspool.drv",EntryPoint="StartPagePrinter",SetLastError=true)]
  public static extern bool StartPage(IntPtr h);
  [DllImport("winspool.drv",EntryPoint="EndPagePrinter",SetLastError=true)]
  public static extern bool EndPage(IntPtr h);
  [DllImport("winspool.drv",EntryPoint="WritePrinter",  SetLastError=true)]
  public static extern bool Write(IntPtr h,IntPtr b,int c,out int w);
}
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)]
public class DI2 {
  [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@
$h=[IntPtr]::Zero
$di=New-Object DI2; $di.pDocName='Drawer'; $di.pDataType='RAW'
$ok=[DP2]::OpenPrinter('${psSafeName}',[ref]$h,[IntPtr]::Zero)
if (-not $ok) { throw "OpenPrinter failed for '${psSafeName}' - verify name in Devices and Printers" }
try {
  [DP2]::StartDoc($h,1,$di)|Out-Null; [DP2]::StartPage($h)|Out-Null
  $b=[System.IO.File]::ReadAllBytes('${psSafeBin}')
  $p=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length)
  [System.Runtime.InteropServices.Marshal]::Copy($b,0,$p,$b.Length)
  $w=0; [DP2]::Write($h,$p,$b.Length,[ref]$w)|Out-Null
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($p)
  [DP2]::EndPage($h)|Out-Null; [DP2]::EndDoc($h)|Out-Null
} finally {
  [DP2]::ClosePrinter($h)|Out-Null
  Remove-Item '${psSafeBin}' -ErrorAction SilentlyContinue
}
`.trimStart();

      // UTF-8 BOM ensures PowerShell reads as UTF-8 on any Windows locale
      fs.writeFileSync(tmpPs, '\uFEFF' + psScript, 'utf8');

      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`,
        { timeout: 8000 },
        (err, _stdout, stderr) => {
          try { fs.unlinkSync(tmpBin); } catch {}
          try { fs.unlinkSync(tmpPs);  } catch {}
          if (err) reject(new Error('Drawer kick failed: ' + (stderr?.trim() || err.message)));
          else resolve({ success: true });
        }
      );
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// APP CONTROL HANDLERS
// ══════════════════════════════════════════════════════════════════════════

function registerAppIPC(ipcMain, win) {
  ipcMain.handle('app:get-version',  () => app.getVersion());
  ipcMain.handle('app:toggle-fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('app:reload', () => win.reload());
  ipcMain.handle('app:quit',   () => app.quit());

  // ── Customer Display control ────────────────────────────────────────────
  ipcMain.handle('app:open-customer-display', () => {
    if (customerDisplayWin && !customerDisplayWin.isDestroyed()) {
      customerDisplayWin.focus();
      return { ok: true, alreadyOpen: true };
    }
    const w = createCustomerDisplay();
    return { ok: !!w, alreadyOpen: false };
  });

  ipcMain.handle('app:close-customer-display', () => {
    if (customerDisplayWin && !customerDisplayWin.isDestroyed()) {
      customerDisplayWin.close();
    }
    return { ok: true };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PERSISTENT CONFIG — backs up critical settings to disk
//
// Why: Electron's localStorage (LevelDB) lives in userData and persists
// across reboots, but can be cleared by accident or during Electron updates.
// We keep a JSON copy of the station config + API URL so the app can
// auto-restore without needing the internet.
// ══════════════════════════════════════════════════════════════════════════

const CONFIG_FILE = path.join(app.getPath('userData'), 'storeveu_station.json');

ipcMain.handle('config:save', (_, data) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:load', () => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
});
