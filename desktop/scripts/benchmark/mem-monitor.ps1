# DreamCoder Memory Monitor
# Samples process memory every N seconds and writes a CSV.
# Also tails the sidecar log for [mem:xterm] / [mem:sidecar] markers.
#
# Usage:
#   .\mem-monitor.ps1
#   .\mem-monitor.ps1 -IntervalSec 1 -MaxSamples 300 -Label "before-lru"
#
# Output CSV: E:\.cache\tmp\dreamcoder-mem-<label>-<timestamp>.csv
# Marker log: E:\.cache\tmp\dreamcoder-markers-<label>-<timestamp>.txt
#
# [mem:xterm] lines come from the WebView process console — capture them via
# DevTools or by redirecting Tauri stdout. They appear in the sidecar stdout
# when the sidecar acts as the JS runtime (non-Tauri dev mode).

param(
    [int]$IntervalSec = 2,
    [string]$OutDir = "E:\.cache\tmp",
    [int]$MaxSamples = 150,
    [string]$Label = "run"
)

$ErrorActionPreference = "Stop"

$WatchNames = @(
    'dreamcoder-desktop', 'DreamCoder', 'dreamcoder',
    'msedgewebview2', 'WebKitWebProcess', 'WebKitNetworkProcess', 'WebView2',
    'bun', 'node',
    'dreamcoder-sidecar'
)

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$csvPath    = Join-Path $OutDir "dreamcoder-mem-${Label}-${ts}.csv"
$markerPath = Join-Path $OutDir "dreamcoder-markers-${Label}-${ts}.txt"

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

"timestamp,elapsed_sec,pid,name,ws_mb,private_mb,cmdline_excerpt" |
    Out-File -FilePath $csvPath -Encoding utf8

$startTime = Get-Date
$peakByName = @{}

Write-Host ""
Write-Host "[monitor] Label   : $Label" -ForegroundColor Cyan
Write-Host "[monitor] CSV     : $csvPath" -ForegroundColor Cyan
Write-Host "[monitor] Markers : $markerPath" -ForegroundColor Cyan
Write-Host "[monitor] Sampling every ${IntervalSec}s x $MaxSamples = $([int]($IntervalSec * $MaxSamples))s max" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Perform the following steps during this capture:" -ForegroundColor Yellow
Write-Host "  1. App starts — wait for UI to appear"
Write-Host "  2. Open 6 session tabs (or as many as you have)"
Write-Host "  3. For each tab: open the terminal panel, type a command, close the panel"
Write-Host "  4. Switch between tabs repeatedly (at least 10 switches)"
Write-Host "  5. Leave idle for 30s"
Write-Host ""

for ($i = 0; $i -lt $MaxSamples; $i++) {
    $now     = Get-Date
    $elapsed = [int]($now - $startTime).TotalSeconds
    $tsStr   = $now.ToString("HH:mm:ss")

    $procs = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            $name = $_.ProcessName
            ($WatchNames | Where-Object { $name -like "*$_*" })
        }

    $totalMb = 0.0

    foreach ($p in $procs) {
        try {
            $wsMb      = [math]::Round($p.WorkingSet64   / 1MB, 1)
            $privateMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)

            $cmd = ""
            try {
                $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
                if ($ci) { $cmd = $ci.CommandLine }
            } catch {}
            if ($cmd) {
                $cmd = $cmd.Replace(",", " ").Replace("`r", " ").Replace("`n", " ")
                if ($cmd.Length -gt 120) { $cmd = $cmd.Substring(0, 120) + "..." }
            }

            $totalMb += $privateMb

            # Track peak per process name
            if (-not $peakByName.ContainsKey($p.ProcessName) -or $peakByName[$p.ProcessName] -lt $privateMb) {
                $peakByName[$p.ProcessName] = $privateMb
            }

            $line = "{0},{1},{2},{3},{4},{5},`"{6}`"" -f `
                $now.ToString("o"), $elapsed, $p.Id, $p.ProcessName, `
                $wsMb, $privateMb, $cmd
            Add-Content -Path $csvPath -Value $line -Encoding utf8
        } catch {}
    }

    $top = $procs | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 4
    $topStr = ($top | ForEach-Object {
        $priv = [math]::Round($_.PrivateMemorySize64 / 1MB, 1)
        "$($_.ProcessName):${priv}MB"
    }) -join " | "

    Write-Host ("[{0}] +{1,3}s  total={2,7:F1}MB  |  {3}" -f $tsStr, $elapsed, $totalMb, $topStr)

    Start-Sleep -Seconds $IntervalSec
}

# Summary
Write-Host ""
Write-Host "=== Peak private memory by process ===" -ForegroundColor Green
$peakByName.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host ("  {0,-35} {1,8:F1} MB" -f $_.Key, $_.Value)
}
Write-Host ""
Write-Host "[monitor] Done. CSV: $csvPath" -ForegroundColor Green
Write-Host "[monitor] Run mem-compare.ps1 with two CSVs to get a before/after diff." -ForegroundColor Cyan

# Write marker file placeholder (manual [mem:xterm] lines can be pasted here)
"# Paste [mem:xterm] / [mem:sidecar] log lines here for correlation" |
    Out-File -FilePath $markerPath -Encoding utf8
