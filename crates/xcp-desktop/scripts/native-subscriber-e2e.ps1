# Real simulator -> existing shared acquisition -> native read-only subscriber.
param([int] $WaitSeconds = 90)
$ErrorActionPreference = "Stop"
if (-not $IsWindows) { throw "Windows required" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$outDir = Join-Path $repo "artifacts/native-gui"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$serverExe = Join-Path $repo "target/debug/xcp-server.exe"
$desktopExe = Join-Path $repo "target/release/xcp-desktop.exe"
if (-not (Test-Path $desktopExe)) { throw "Native Release binary missing" }
Push-Location $repo
try {
    cargo build -p xcp-server
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
}
finally { Pop-Location }
$server = $null
$desktop = $null
$id = $null
$base = "http://127.0.0.1:8080"
try {
    $server = Start-Process -FilePath $serverExe -WorkingDirectory $repo -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "$base/api/v1/health" -TimeoutSec 2
            if ($health.mode -eq "simulation") { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw "XCP simulator backend not listening" }
    $connected = Invoke-RestMethod -Uri "$base/api/xcp/connect" -Method Post -TimeoutSec 5
    if (-not $connected.connected) { throw "Simulator connect failed" }
    $body = @{
        interval_ms = 100
        signals = @(
            @{ name = "Engine speed"; address = 4096; value_type = "u32" },
            @{ name = "Coolant"; address = 4100; value_type = "f32" }
        )
    } | ConvertTo-Json -Depth 8
    $started = Invoke-RestMethod -Uri "$base/api/v1/acquisitions" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 5
    if ($started.state -ne "running") { throw "Acquisition not running" }
    $id = [string]$started.acquisition_id
    if (-not $id.StartsWith("acq-")) { throw "Invalid acquisition ID" }
    $before = Invoke-RestMethod -Uri "$base/api/v1/acquisitions/$id" -TimeoutSec 5
    if ($before.subscriber_count -ne 0) { throw "Unexpected preexisting subscriber" }
    $screenshot = Join-Path $outDir "native-subscriber-rendered.png"
    Remove-Item $screenshot -ErrorAction SilentlyContinue
    $desktop = Start-Process -FilePath $desktopExe -ArgumentList @("--subscribe-acquisition=$id","--screenshot=$screenshot") -WorkingDirectory $outDir -PassThru
    $joined = $false
    $joinedAt = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        $desktop.Refresh()
        if ($desktop.HasExited) { throw "Native window exited before subscription" }
        $current = Invoke-RestMethod -Uri "$base/api/v1/acquisitions/current" -TimeoutSec 3
        if ($current.acquisition_id -ne $id) { throw "Native viewer changed backend acquisition" }
        $status = Invoke-RestMethod -Uri "$base/api/v1/acquisitions/$id" -TimeoutSec 3
        if ($status.subscriber_count -eq 1 -and -not $joined) {
            $joined = $true
            $joinedAt = [DateTime]::UtcNow
        }
        if ($joined -and (Test-Path $screenshot)) { break }
        if ($joined -and ([DateTime]::UtcNow - $joinedAt).TotalSeconds -gt 5) { break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $joined) { throw "Native subscriber never attached" }
    if (Test-Path $screenshot) {
        $screenshotName = "native-subscriber-rendered.png"
    } else {
        $desktop.Refresh()
        if ($desktop.MainWindowHandle -eq [IntPtr]::Zero) {
            throw "Read-only native viewer attached but neither framebuffer screenshot nor desktop window available"
        }
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        if ($null -eq $screen) { throw "Cannot capture real native subscriber desktop" }
        $bounds = $screen.Bounds
        $screenshotName = "native-subscriber-windows.png"
        $bmp = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            }
            finally { $graphics.Dispose() }
            $bmp.Save((Join-Path $outDir $screenshotName), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $bmp.Dispose() }
    }
    $session = Invoke-RestMethod -Uri "$base/api/v1/sessions/current" -TimeoutSec 5
    if (-not $session.connected) { throw "Viewer unexpectedly disconnected XCP session" }
    [ordered]@{
        observedAtUtc = [DateTime]::UtcNow.ToString("o")
        mode = "Rust simulator / preexisting shared acquisition"
        acquisitionId = $id
        subscribersBefore = $before.subscriber_count
        subscribersDuringNative = $status.subscriber_count
        singleSessionRemainedConnected = [bool]$session.connected
        screenshot = $screenshotName
        limitation = "Not real hardware/DAQ. This viewer subscribed, it did not start an XCP session or acquisition."
    } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $outDir "native-readonly-subscriber-e2e.json")
    Write-Host "PASS native GUI subscriber on existing Rust simulator acquisition"
}
finally {
    if ($null -ne $desktop -and -not $desktop.HasExited) { Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue }
    if ($null -ne $id) { try { Invoke-RestMethod -Uri "$base/api/v1/acquisitions/$id/stop" -Method Post -TimeoutSec 3 | Out-Null } catch {} }
    try { Invoke-RestMethod -Uri "$base/api/xcp/disconnect" -Method Post -TimeoutSec 3 | Out-Null } catch {}
    if ($null -ne $server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
