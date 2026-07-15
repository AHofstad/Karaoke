# Builds the NSIS installer and the portable zip into dist\.
# Usage: .\scripts\release.ps1   (run from the repo root)
$ErrorActionPreference = "Stop"
# Invoke-WebRequest's progress-bar rendering makes downloads dramatically
# slower (often 10-50x) than the actual network speed; suppress it.
$ProgressPreference = "SilentlyContinue"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ffmpeg sidecar: always kept at the latest gyan.dev release build. Each run
# compares the installed version against the published one and re-downloads
# when they differ; network failure keeps the existing binary.
$ffmpegSidecar = "src-tauri\binaries\karaoke-ffmpeg-x86_64-pc-windows-msvc.exe"

function Get-InstalledFfmpegVersion {
    if (-not (Test-Path $ffmpegSidecar)) { return $null }
    $line = (& $ffmpegSidecar -version 2>$null | Select-Object -First 1)
    if ($line -match "ffmpeg version (\d+[^\s-]*)") { return $Matches[1] }
    return $null
}

$installed = Get-InstalledFfmpegVersion
$latest = $null
try {
    $resp = (Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/release-version" -TimeoutSec 15 -UseBasicParsing).Content
    # Server sends application/octet-stream, so Content may be a byte array.
    $latest = if ($resp -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($resp).Trim() } else { "$resp".Trim() }
} catch {
    Write-Warning "Could not check the latest ffmpeg version ($($_.Exception.Message))"
}

if ($latest -and $installed -ne $latest) {
    $installedLabel = if ($installed) { $installed } else { "(none)" }
    Write-Host "Updating ffmpeg $installedLabel -> $latest..." -ForegroundColor Cyan
    $zip = Join-Path $env:TEMP "ffmpeg-release-essentials.zip"
    $extract = Join-Path $env:TEMP "ffmpeg-release-essentials"
    Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive $zip -DestinationPath $extract
    $exe = Get-ChildItem $extract -Recurse -Filter ffmpeg.exe | Select-Object -First 1
    if (-not $exe) { throw "ffmpeg.exe not found in downloaded archive" }
    New-Item -ItemType Directory -Force (Split-Path $ffmpegSidecar) | Out-Null
    Copy-Item $exe.FullName $ffmpegSidecar -Force
    Remove-Item $zip, $extract -Recurse -Force
} elseif ($installed) {
    Write-Host "ffmpeg $installed is up to date" -ForegroundColor Green
}
if (-not (Test-Path $ffmpegSidecar)) {
    throw "No ffmpeg sidecar and download failed - cannot build"
}

$version = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
Write-Host "Building Karaoke $version..." -ForegroundColor Cyan

npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

New-Item -ItemType Directory -Force dist | Out-Null

# Installer
Copy-Item "src-tauri\target\release\bundle\nsis\Karaoke_${version}_x64-setup.exe" dist\ -Force

# Portable zip: exe + ffmpeg sidecar + readme
$staging = Join-Path $env:TEMP "karaoke-portable-$version"
New-Item -ItemType Directory -Force $staging | Out-Null
Copy-Item src-tauri\target\release\karaoke.exe $staging -Force
Copy-Item src-tauri\target\release\karaoke-ffmpeg.exe $staging -Force
@"
Karaoke $version (portable)
========================
1. Keep karaoke.exe and karaoke-ffmpeg.exe in the same folder.
2. Start karaoke.exe, click "Change song folder..." and pick your UltraStar songs folder.
3. Guests: scan the QR code (same Wi-Fi) to queue songs from their phone.
   Allow "Private networks" if Windows Firewall asks.

Keys while singing: Space pause | Left/Right seek | Tab skip | +/- display offset | Esc back
Requires Windows 10/11 (uses the built-in WebView2 runtime).
"@ | Set-Content "$staging\README.txt"
Compress-Archive "$staging\*" -DestinationPath "dist\Karaoke_${version}_portable.zip" -Force
Remove-Item $staging -Recurse -Force

Write-Host "Done:" -ForegroundColor Green
Get-ChildItem dist | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
