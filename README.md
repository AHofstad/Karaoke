# Karaoke

> 🤖 **This project was developed with [Claude Code](https://claude.com/claude-code)**, Anthropic's AI coding assistant. The codebase, UI/UX, and architecture reflect AI-assisted development practices.

UltraStar-compatible karaoke player for Windows and Linux (Debian/Ubuntu), in the spirit of Performous / UltraStar Play — playback only (no microphone, no scoring). Plays audio and/or video with bouncing-syllable lyrics, supports duets (P1/P2), a cover-grid song browser with search, a play queue, and a **phone remote**: guests on the same Wi-Fi scan a QR code and queue songs from their phones.

## For players

### Installation & setup

1. Install with `Karaoke_x.y.z_x64-setup.exe` (or unzip the portable zip anywhere).
2. Start the app, click **Change song folder…** and pick your UltraStar songs folder.
3. Click a cover to sing it, or **+** to queue it. **▶ Play queue** starts the queue.
4. Guests: scan the QR code in the sidebar (same Wi-Fi) to browse and queue from a phone.

First launch may show a Windows Firewall prompt — allow **Private networks**, otherwise phones can't reach the app.

### Linux (Debian/Ubuntu)

Install with the `.deb` package, or run the `.AppImage` directly (`chmod +x` it first; needs FUSE — if your system lacks it, run with `--appimage-extract-and-run`).

**Windows bundles its own codecs (WebView2/Chromium); Linux does not** — the app's webview (WebKitGTK) decodes audio/video through your system's GStreamer install, so some codec plugins may need installing manually:

```sh
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
```

- `gstreamer1.0-plugins-ugly`/`gstreamer1.0-libav` cover MP3 and H.264/MP4 — the two formats most likely to be missing on a fresh install.
- WebM/VP9 and Ogg/Vorbis usually work out of the box (`-good`/`-base`, installed by most desktop distros by default).
- If a song fails to play with a "GStreamer/codec" hint in the error, install the packages above and restart the song.
- Fedora/RPM-based distros aren't officially supported yet (patent-encumbered codecs need RPM Fusion) — the app may still run, but expect more manual codec setup.

The LAN remote has no Windows-Firewall-style prompt on Linux. If phones can't reach the app and you have `ufw`/`firewalld` active, allow the port the app displays: `sudo ufw allow <port>/tcp`.

### Features

**Playback & display:**
- Canvas-based syllable-by-syllable lyrics (bouncing effect on active syllable)
- Song length displayed on library cards and queue
- Video/background with automatic brightness adjustment
- Countdown dots during the 5s lead-in before a song starts
- Live lyrics scanner: instantly detects long instrumental sections (>15s) where both voices are silent

**Control & UI:**
- Separate pause screen with full keyboard shortcut reference and live settings display (press **Esc** while singing)
- Queue sidebar on desktop with up/down arrow buttons to reorder (no drag-and-drop flakiness)
- Phone remote: guests queue songs and see live ETAs via QR code link
- Display offset adjustment (±50 ms, persisted) for syncing with beamer/TV lag

**Queue management:**
- Live queue preview while singing (press **Q** to toggle a side panel showing next 8 songs with ETAs)
- Intermission screen after each song (3s to see what's next before playback resumes)
- Queue reorder via arrow buttons on both desktop sidebar and phone remote
- Queue can be cleared or played starting from any position

**Audio & video:**
- Loudness normalization (LUFS-based, per-song) so all songs play equally loud
- Automatic media conversion: songs with incompatible audio/video (`.avi`, MPEG Layer II posing as mp3, etc.) are transcoded once with ffmpeg and cached
- Support for single-voice and duet (P1/P2 colors) charts

**Song library:**
- Cover grid with configurable search (artist, title, tags)
- Badges: duet, video, played-before
- Live scan progress bar when library changes
- Lenient UltraStar `.txt` parser: handles comma decimals, missing tags, wrong-case tags, wrong media extensions, `#RELATIVE` mode, rap/golden/freestyle notes

### Keys while singing

| Key | Action |
| --- | --- |
| **Space** | Pause / resume |
| **←** / **→** | Seek ±5 s |
| **Tab** | Skip instrumental section (if one is active) or skip to next queued song |
| **+** / **−** | Display offset ±50 ms (saved) |
| **F** | Toggle syllable fill mode: instant vs. progressive fill |
| **Q** | Toggle queue preview panel (right sidebar, shows next 8 songs + ETAs) |
| **Esc** | Show full shortcuts & settings, or quit to library |

### Syllable rendering

- **Instant fill** (toggled via **F**): syllables become fully opaque instantly when their note starts.
- **Progressive fill** (default): syllables gradually brighten as they're sung, matching the note's timing within the syllable.

Both modes persist your preference across sessions.

### Song format notes

Charts are standard UltraStar `.txt` files. The parser is deliberately lenient (comma decimals, missing tags, wrong-case tags, wrong media extensions, `#RELATIVE` mode, rap/golden/freestyle notes). Media the built-in player can't decode (`.avi` video, MPEG Layer II audio posing as mp3) is converted once with the bundled ffmpeg and cached next to the song as `<name>.karaoke.mp3/.mp4`.

Golden notes are treated as normal notes (no special rendering).

## For developers

**Windows:** Node 20+ and a Rust toolchain (MSVC). The ffmpeg sidecar (`src-tauri/binaries/karaoke-ffmpeg-x86_64-pc-windows-msvc.exe`, untracked) is downloaded/updated automatically by the release script; for `tauri dev` transcode testing before the first release build, copy any ffmpeg.exe there manually (renamed to match) or run the release script once.

```powershell
npm install
npm run tauri dev     # run the app
npm test              # parser/unit tests (golden corpus lives in Research\songs)
npm run check         # svelte-check
npm run tauri build   # NSIS installer + release exe
```

**Linux (Debian/Ubuntu):** Node 20+, a Rust toolchain, and Tauri's build dependencies:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Drop a Linux static ffmpeg build at `src-tauri/binaries/karaoke-ffmpeg-x86_64-unknown-linux-gnu` (untracked, matching the sidecar naming convention — e.g. from [BtbN's ffmpeg-builds](https://github.com/BtbN/FFmpeg-Builds) linux64-gpl release) before `tauri dev`/`tauri build` for transcode testing. The sidecar is named `karaoke-ffmpeg`, not `ffmpeg`, because Tauri's `.deb` bundler installs `externalBin` sidecars into `/usr/bin` by their base name — a plain `ffmpeg` would collide with the system's real `ffmpeg` package.

```sh
npm install
npm run tauri dev     # run the app
npm test
npm run check
npm run tauri build   # produces .deb + .AppImage under src-tauri/target/release/bundle/
```

Build on an older base (Ubuntu 22.04/Debian 12, or a pinned Docker image matching that) to keep the glibc/webkitgtk floor low for end users on older systems.

### Making a release (installer + portable zip)

1. Bump `version` in `src-tauri/tauri.conf.json` (and keep `package.json` / `src-tauri/Cargo.toml` in sync).
2. Run from the repo root:

```powershell
.\scripts\release.ps1
```

This runs `tauri build` and drops both artifacts in `dist\`:
- `Karaoke_<version>_x64-setup.exe` — NSIS installer (from `src-tauri\target\release\bundle\nsis\`)
- `Karaoke_<version>_portable.zip` — `karaoke.exe` + `karaoke-ffmpeg.exe` + README.txt zipped from `src-tauri\target\release\`

The portable exe needs `karaoke-ffmpeg.exe` next to it (the script includes it); the installer bundles it automatically.

The script checks gyan.dev for the latest ffmpeg release on every run and updates the sidecar automatically when a newer version exists (keeps the current one if offline).

### Making a Linux release (.deb + .AppImage)

Run from the repo root on Ubuntu 22.04/Debian 12 (or a pinned Docker image at that baseline):

```sh
./scripts/release.sh
```

This fetches/updates the Linux ffmpeg sidecar, runs `tauri build`, and drops version-stamped artifacts in `dist/`. `release.sh` and `release.ps1` are independent — neither calls the other, and each is responsible for keeping its own platform's sidecar/version in sync; a version bump or ffmpeg-source change made in one should be mirrored in the other by hand.

Architecture and milestone plan: see [PLAN.md](PLAN.md).

## License

GPL v3 — see [LICENSE](LICENSE). Modifications and derivative works distributed to others must remain open source under the same license.
