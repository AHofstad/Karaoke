# Builds the NSIS installer and the portable zip into dist\.
# Usage: .\scripts\release.ps1 [-UpdateFfmpeg]
#   -UpdateFfmpeg: re-download the latest ffmpeg even if one is already present
param([switch]$UpdateFfmpeg)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ffmpeg sidecar: downloaded on first run (latest gyan.dev release-essentials
# build), refreshed with -UpdateFfmpeg.
$ffmpegSidecar = "src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe"
if ($UpdateFfmpeg -or -not (Test-Path $ffmpegSidecar)) {
    Write-Host "Downloading latest ffmpeg (release-essentials)..." -ForegroundColor Cyan
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
    & $ffmpegSidecar -version | Select-Object -First 1
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
Copy-Item src-tauri\target\release\ffmpeg.exe $staging -Force
@"
Karaoke $version (portable)
========================
1. Keep karaoke.exe and ffmpeg.exe in the same folder.
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
