#!/usr/bin/env bash
# Builds the .deb and .AppImage into dist/.
# Usage: ./scripts/release.sh   (run from the repo root, on Ubuntu 22.04/Debian 12
# or a pinned Docker image at that baseline, to keep the glibc/webkitgtk floor low)
#
# Independent of scripts/release.ps1 — neither script calls the other. Keep
# their ffmpeg-update logic and version handling conceptually in sync by hand.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

ffmpeg_sidecar="src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu"
ffmpeg_url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"

installed_version() {
  if [ -x "$ffmpeg_sidecar" ]; then
    "$ffmpeg_sidecar" -version 2>/dev/null | head -n1 | grep -oP 'ffmpeg version \K[^\s-]+' || true
  fi
}

before="$(installed_version || true)"
echo "Fetching latest ffmpeg (BtbN linux64-gpl)..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if curl -fsSL "$ffmpeg_url" -o "$tmp/ffmpeg.tar.xz"; then
  tar -xf "$tmp/ffmpeg.tar.xz" -C "$tmp"
  extracted="$(find "$tmp" -type f -name ffmpeg -perm -u+x | head -n1)"
  if [ -z "$extracted" ]; then
    extracted="$(find "$tmp" -type f -name ffmpeg | head -n1)"
  fi
  if [ -z "$extracted" ]; then
    echo "ffmpeg binary not found in downloaded archive" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$ffmpeg_sidecar")"
  cp "$extracted" "$ffmpeg_sidecar"
  chmod +x "$ffmpeg_sidecar"
  after="$(installed_version || true)"
  echo "ffmpeg: ${before:-none} -> ${after:-unknown}"
else
  echo "Warning: could not download ffmpeg; keeping existing sidecar" >&2
fi

if [ ! -x "$ffmpeg_sidecar" ]; then
  echo "No ffmpeg sidecar and download failed - cannot build" >&2
  exit 1
fi

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
echo "Building Karaoke $version..."

npm run tauri build

mkdir -p dist

deb_src="$(find src-tauri/target/release/bundle/deb -name '*.deb' | head -n1)"
appimage_src="$(find src-tauri/target/release/bundle/appimage -name '*.AppImage' | head -n1)"

if [ -z "$deb_src" ]; then
  echo "No .deb produced — check tauri.conf.json bundle.targets" >&2
  exit 1
fi
if [ -z "$appimage_src" ]; then
  echo "No .AppImage produced — check tauri.conf.json bundle.targets" >&2
  exit 1
fi

cp "$deb_src" "dist/Karaoke_${version}_amd64.deb"
cp "$appimage_src" "dist/Karaoke_${version}_x86_64.AppImage"
chmod +x "dist/Karaoke_${version}_x86_64.AppImage"

echo "Done:"
ls -lh dist/
