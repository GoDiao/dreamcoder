param(
    [Parameter(Mandatory)][string]$Before,
    [Parameter(Mandatory)][string]$After,
    [string]$OutReport = ""
)

$ErrorActionPreference = "Stop"

function Read-MemCsv([string]$path) {
    if (-not (Test-Path $path)) {
        throw "File not found: $path"
    }
    $rows = Import-Csv -Path $path -Encoding utf8
    $byName = @{}
    foreach ($row in $rows) {
        $name = $row.name
        $priv = [double]$row.private_mb
        if (-not $byName.ContainsKey($name)) {
            $byName[$name] = @{ peak = $priv; sum = $priv; count = 1 }
        } else {
            if ($priv -gt $byName[$name].peak) { $byName[$name].peak = $priv }
            $byName[$name].sum   += $priv
            $byName[$name].count += 1
        }
    }
    return $byName
}

function Format-Delta([double]$before, [double]$after) {
    $delta = $after - $before
    $pct   = if ($before -gt 0) { ($delta / $before) * 100 } else { 0 }
    $sign  = if ($delta -ge 0) { "+" } else { "" }
    $color = if ($delta -le -10) { "Green" } elseif ($delta -ge 10) { "Red" } else { "White" }
    return @{
        text  = "{0}{1:F1} MB ({2}{3:F1}%)" -f $sign, $delta, $sign, $pct
        color = $color
    }
}

Write-Host ""
Write-Host "=== DreamCoder Memory Comparison ===" -ForegroundColor Cyan
Write-Host "  Before : $Before" -ForegroundColor DarkGray
Write-Host "  After  : $After"  -ForegroundColor DarkGray
Write-Host ""

$bData = Read-MemCsv $Before
$aData = Read-MemCsv $After

$allNames = @($bData.Keys) + @($aData.Keys) | Sort-Object -Unique

$lines = @()

$hdr = "{0,-35} {1,10} {2,10} {3,22} {4,10} {5,10} {6,22}" -f `
    "Process", "Peak-B(MB)", "Peak-A(MB)", "Peak-Delta", "Avg-B(MB)", "Avg-A(MB)", "Avg-Delta"
Write-Host $hdr -ForegroundColor White
Write-Host ("-" * 120)

$totalPeakB = 0.0
$totalPeakA = 0.0

foreach ($name in $allNames) {
    $b = $bData[$name]
    $a = $aData[$name]

    $peakB = if ($b) { $b.peak } else { 0.0 }
    $peakA = if ($a) { $a.peak } else { 0.0 }
    $avgB  = if ($b) { $b.sum / $b.count } else { 0.0 }
    $avgA  = if ($a) { $a.sum / $a.count } else { 0.0 }

    $totalPeakB += $peakB
    $totalPeakA += $peakA

    $peakDelta = Format-Delta $peakB $peakA
    $avgDelta  = Format-Delta $avgB  $avgA

    $row = "{0,-35} {1,10:F1} {2,10:F1} {3,-22} {4,10:F1} {5,10:F1} {6,-22}" -f `
        $name, $peakB, $peakA, $peakDelta.text, $avgB, $avgA, $avgDelta.text

    $deltaColor = $peakDelta.color
    Write-Host $row -ForegroundColor $deltaColor
    $lines += $row
}

Write-Host ("-" * 120)

$totalDelta = Format-Delta $totalPeakB $totalPeakA
$totalRow = "{0,-35} {1,10:F1} {2,10:F1} {3,-22}" -f `
    "TOTAL (all processes)", $totalPeakB, $totalPeakA, $totalDelta.text
Write-Host $totalRow -ForegroundColor ($totalDelta.color)

Write-Host ""

$xtermNames = $allNames | Where-Object { $_ -match "dreamcoder|msedge|WebKit|bun" }
if ($xtermNames) {
    Write-Host "=== WebView / Renderer processes (most relevant for xterm) ===" -ForegroundColor Yellow
    foreach ($name in $xtermNames) {
        $b = $bData[$name]
        $a = $aData[$name]
        $peakB = if ($b) { $b.peak } else { 0.0 }
        $peakA = if ($a) { $a.peak } else { 0.0 }
        $d = Format-Delta $peakB $peakA
        Write-Host ("  {0,-35} before={1,8:F1}MB  after={2,8:F1}MB  delta={3}" -f $name, $peakB, $peakA, $d.text) -ForegroundColor ($d.color)
    }
    Write-Host ""
}

if ($OutReport) {
    $report = @(
        "DreamCoder Memory Comparison Report"
        "Before: $Before"
        "After : $After"
        "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ""
        $hdr
        ("-" * 120)
    ) + $lines + @(
        ("-" * 120)
        $totalRow
    )
    $report | Out-File -FilePath $OutReport -Encoding utf8
    Write-Host "[compare] Report written to: $OutReport" -ForegroundColor Cyan
}
