# Karaoke

UltraStar-compatible karaoke player for Windows, in the spirit of Performous / UltraStar Play — playback only (no microphone, no scoring). Plays audio and/or video with bouncing-syllable lyrics, supports duets (P1/P2), a cover-grid song browser with search, a play queue, and a **phone remote**: guests on the same Wi-Fi scan a QR code and queue songs from their phones.

## For players

1. Install with `Karaoke_x.y.z_x64-setup.exe` (or unzip the portable zip anywhere).
2. Start the app, click **Change song folder…** and pick your UltraStar songs folder.
3. Click a cover to sing it, or **+** to queue it. **▶ Play queue** starts the queue.
4. Guests: scan the QR code in the sidebar (same Wi-Fi) to browse and queue from a phone.

First launch may show a Windows Firewall prompt — allow **Private networks**, otherwise phones can't reach the app.

### Keys while singing

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| ← / → | Seek ±5 s |
| Tab | Skip to next queued song |
| + / − | Display offset ±50 ms (fix beamer/TV lag; saved) |
| Esc | Back to the song list (queue stays) |

### Song format notes

Charts are standard UltraStar `.txt` files. The parser is deliberately lenient (comma decimals, missing tags, wrong-case tags, wrong media extensions, `#RELATIVE` mode, rap/golden/freestyle notes). Media the built-in player can't decode (`.avi` video, MPEG Layer II audio posing as mp3) is converted once with the bundled ffmpeg and cached next to the song as `<name>.karaoke.mp3/.mp4`.

## For developers

Prereqs: Node 20+ and a Rust toolchain (MSVC). The ffmpeg sidecar (`src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`, untracked) is downloaded/updated automatically by the release script; for `tauri dev` transcode testing before the first release build, copy any ffmpeg.exe there manually or run the release script once.

```powershell
npm install
npm run tauri dev     # run the app
npm test              # parser/unit tests (golden corpus lives in Research\songs)
npm run check         # svelte-check
npm run tauri build   # NSIS installer + release exe
```

### Making a release (installer + portable zip)

1. Bump `version` in `src-tauri/tauri.conf.json` (and keep `package.json` / `src-tauri/Cargo.toml` in sync).
2. Run from the repo root:

```powershell
.\scripts\release.ps1
```

This runs `tauri build` and drops both artifacts in `dist\`:
- `Karaoke_<version>_x64-setup.exe` — NSIS installer (from `src-tauri\target\release\bundle\nsis\`)
- `Karaoke_<version>_portable.zip` — `karaoke.exe` + `ffmpeg.exe` + README.txt zipped from `src-tauri\target\release\`

The portable exe needs `ffmpeg.exe` next to it (the script includes it); the installer bundles it automatically.

The script checks gyan.dev for the latest ffmpeg release on every run and updates the sidecar automatically when a newer version exists (keeps the current one if offline).

Architecture and milestone plan: see [PLAN.md](PLAN.md).
