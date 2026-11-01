# Windows interactive desktop benchmark: never fabricate screenshots or timings.
param([int] $WaitSeconds = 90)
$ErrorActionPreference = "Stop"
if (-not $IsWindows) { throw "Windows required" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$outDir = Join-Path $repo "artifacts/native-gui"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Push-Location $repo
try {
    cargo test -p xcp-desktop
    if ($LASTEXITCODE -ne 0) { throw "Native crate tests failed" }
    cargo build --release -p xcp-desktop
    if ($LASTEXITCODE -ne 0) { throw "Release compilation failed" }
}
finally { Pop-Location }
$binary = Join-Path $repo "target/release/xcp-desktop.exe"
if (-not (Test-Path $binary)) { throw "Missing Release binary" }
$process = $null
Push-Location $outDir
try {
    Remove-Item "xcp-native-benchmark-2000.json", "xcp-native-benchmark-20000.json" -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath $binary -ArgumentList "--benchmark" -WorkingDirectory $outDir -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while (-not ((Test-Path "xcp-native-benchmark-2000.json") -and (Test-Path "xcp-native-benchmark-20000.json"))) {
        $process.Refresh()
        if ($process.HasExited) { throw "Native GUI exited before reports completed" }
        if ([DateTime]::UtcNow -gt $deadline) { throw "Timed out waiting for two actual measurements" }
        Start-Sleep -Milliseconds 250
    }
    $r2k = Get-Content "xcp-native-benchmark-2000.json" -Raw | ConvertFrom-Json
    $r20k = Get-Content "xcp-native-benchmark-20000.json" -Raw | ConvertFrom-Json
    if (($r2k.framesPerUpdate -ne 2000) -or ($r20k.framesPerUpdate -ne 20000) -or ($r2k.updates -ne 80) -or ($r20k.updates -ne 80)) {
        throw "Unexpected benchmark fixture or update count"
    }
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw "No interactive GUI window; screenshot not collected" }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    if ($null -eq $screen) { throw "No desktop; screenshot not collected" }
    $bounds = $screen.Bounds
    $bmp = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        }
        finally { $graphics.Dispose() }
        $bmp.Save((Join-Path $outDir "native-workspace-windows.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $bmp.Dispose() }
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $os = Get-CimInstance Win32_OperatingSystem
    [ordered]@{
        measuredAtUtc = [DateTime]::UtcNow.ToString("o")
        os = $os.Caption
        osVersion = $os.Version
        cpu = $cpu.Name
        logicalProcessors = [Environment]::ProcessorCount
        screen = "$($bounds.Width)x$($bounds.Height)"
        note = "Actual native Windows screenshot; synthetic samples, not ECU data"
    } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $outDir "windows-environment.json")
    Write-Host "Actual desktop benchmark/screenshot: $outDir"
}
finally {
    if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    Pop-Location
}
