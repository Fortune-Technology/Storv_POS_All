# scale-probe.ps1 — Diagnose a serial-over-LAN scale bridge from the Windows POS.
#
# What it does:
#   1. Pings the bridge IP to confirm it's reachable
#   2. Tries to open a raw TCP socket to the bridge port
#   3. If it connects, listens for 6 seconds and reports every byte received
#       (so you can see if the scale is pushing weight strings, and at what cadence)
#
# Usage from PowerShell on the Windows POS terminal:
#   powershell -ExecutionPolicy Bypass -File scale-probe.ps1 -Ip 192.168.1.50 -Port 4001
#
# Or interactively (it will prompt):
#   powershell -ExecutionPolicy Bypass -File scale-probe.ps1
#
# When MarketPOS works but our app doesn't, run this against the SAME IP/port
# MarketPOS uses. If MarketPOS scale config is hidden, find the IP from the
# bridge's web UI or DHCP lease list on your router.

param(
  [string]$Ip,
  [int]$Port = 4001
)

if (-not $Ip) {
  $Ip = Read-Host "Enter bridge IP (e.g. 192.168.1.50)"
}
if (-not $Port) {
  $Port = [int](Read-Host "Enter bridge TCP port (default 4001)")
  if (-not $Port) { $Port = 4001 }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Scale Bridge Probe — $Ip`:$Port" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: ICMP ping ──────────────────────────────────────────────────
Write-Host "[1/3] Pinging $Ip ..." -ForegroundColor Yellow
$pingOk = Test-Connection -ComputerName $Ip -Count 2 -Quiet -ErrorAction SilentlyContinue
if ($pingOk) {
  Write-Host "      OK — bridge replies to ICMP." -ForegroundColor Green
} else {
  Write-Host "      FAIL — bridge does not reply to ping." -ForegroundColor Red
  Write-Host "      Possible causes:" -ForegroundColor Red
  Write-Host "        - Wrong IP entered" -ForegroundColor Red
  Write-Host "        - Bridge powered off / cable unplugged" -ForegroundColor Red
  Write-Host "        - Bridge on a different VLAN / subnet from this PC" -ForegroundColor Red
  Write-Host "        - Windows Firewall blocks outbound ICMP (rare)" -ForegroundColor Red
  Write-Host "      Note: some bridges block ICMP but still accept TCP — continuing anyway." -ForegroundColor Yellow
}
Write-Host ""

# ── Step 2: TCP connect ────────────────────────────────────────────────
Write-Host "[2/3] Opening TCP socket to $Ip`:$Port ..." -ForegroundColor Yellow
$client = New-Object System.Net.Sockets.TcpClient
$client.ReceiveTimeout = 6000
$client.SendTimeout    = 3000
$connectTask = $client.ConnectAsync($Ip, $Port)
$connected   = $connectTask.Wait(5000)

if (-not $connected) {
  $client.Close()
  Write-Host "      FAIL — connection timed out after 5 seconds." -ForegroundColor Red
  Write-Host "      Possible causes:" -ForegroundColor Red
  Write-Host "        - Wrong port (try 4001 / 9100 / 10001 / 8899 / 23 / 2101)" -ForegroundColor Red
  Write-Host "        - Bridge is in 'Telnet' or 'RFC2217' mode, not raw TCP server" -ForegroundColor Red
  Write-Host "        - Windows Firewall blocking outbound to that port" -ForegroundColor Red
  Write-Host "        - Bridge is listening on a different port for this serial channel" -ForegroundColor Red
  exit 1
}

Write-Host "      OK — TCP socket open." -ForegroundColor Green
Write-Host ""

# ── Step 3: Listen for data ────────────────────────────────────────────
Write-Host "[3/3] Listening for 6 seconds. Place something on the scale or scan a barcode now..." -ForegroundColor Yellow
Write-Host ""
$stream = $client.GetStream()
$buffer = New-Object byte[] 4096
$received = New-Object System.Text.StringBuilder
$totalBytes = 0
$startTime = Get-Date

while ((Get-Date) -lt $startTime.AddSeconds(6)) {
  if ($stream.DataAvailable) {
    $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
    if ($bytesRead -gt 0) {
      $totalBytes += $bytesRead
      $chunk = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $bytesRead)
      [void]$received.Append($chunk)
      # Print readable chunks live, one line at a time
      foreach ($ch in [char[]]$chunk) {
        if ($ch -eq "`n") {
          Write-Host "      << " -ForegroundColor Gray -NoNewline
          Write-Host "(line break)" -ForegroundColor DarkGray
        } elseif ([int]$ch -lt 32) {
          Write-Host "      << " -ForegroundColor Gray -NoNewline
          Write-Host ("(0x{0:X2})" -f [int]$ch) -ForegroundColor DarkGray
        } else {
          Write-Host -NoNewline -ForegroundColor White $ch
        }
      }
    }
  }
  Start-Sleep -Milliseconds 100
}

Write-Host ""
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " RESULT" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($totalBytes -eq 0) {
  Write-Host "Received 0 bytes." -ForegroundColor Red
  Write-Host ""
  Write-Host "TCP is open but the bridge isn't pushing any serial data." -ForegroundColor Red
  Write-Host "Possible causes:" -ForegroundColor Yellow
  Write-Host "  - Scale is powered off / not connected to the bridge's serial port" -ForegroundColor Yellow
  Write-Host "  - Bridge serial settings don't match scale (try 9600 8N1)" -ForegroundColor Yellow
  Write-Host "  - You're connected to the wrong serial channel on a multi-port bridge" -ForegroundColor Yellow
  Write-Host "    (try port 4002 for channel 2, 4003 for channel 3, etc.)" -ForegroundColor Yellow
  Write-Host "  - Scale is 'request/response' mode and needs a poll command sent first" -ForegroundColor Yellow
  Write-Host "    (rare for Magellan — usually streams continuously)" -ForegroundColor Yellow
  Write-Host "  - Bridge in 'Virtual COM' mode — needs Lantronix/Moxa VCP driver instead" -ForegroundColor Yellow
} else {
  Write-Host "Received $totalBytes bytes." -ForegroundColor Green
  Write-Host ""
  Write-Host "Raw text received:" -ForegroundColor White
  Write-Host "------------------" -ForegroundColor DarkGray
  Write-Host $received.ToString()
  Write-Host "------------------" -ForegroundColor DarkGray
  Write-Host ""

  # Try to parse a weight value
  $text = $received.ToString()
  $weightMatch = [regex]::Match($text, '([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g|G|oz|OZ)')
  if ($weightMatch.Success) {
    Write-Host "Detected weight: $($weightMatch.Value)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Bridge + scale are working. Use these settings in cashier-app:" -ForegroundColor Green
    Write-Host "  Connection: TCP / Serial-over-LAN"
    Write-Host "  IP:         $Ip"
    Write-Host "  Port:       $Port"
  } else {
    Write-Host "Got data but no recognizable weight string." -ForegroundColor Yellow
    Write-Host "The cashier-app expects a string matching:" -ForegroundColor Yellow
    Write-Host "  ([+-]?digits.digits)(kg|lb|g|oz)" -ForegroundColor DarkGray
    Write-Host "If your scale uses a different format, share the raw bytes above." -ForegroundColor Yellow
  }
}

$stream.Close()
$client.Close()
