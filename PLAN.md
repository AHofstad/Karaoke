# Karaoke Player — Project Plan & Progress

> Living document. Update the checkboxes and the progress log at the bottom as work completes.

## Goal

Windows desktop karaoke app in the spirit of UltraStar Play / Performous, but **playback-only**: plays a song's audio and/or video with UltraStar-timed lyrics on screen (bouncing syllable highlight). No microphone, no pitch detection, no scoring. Supports **duet files** (P1/P2, two lyric lanes), a **song library browser** with covers and search, and a **LAN remote**: guests on the same local network browse to a web page served by the app to search the library and add songs to the play queue (no internet required). Shareable with non-technical people as a portable zip / simple installer.

Reference material:
- Spec: `Research\UltraStar_Format_Specification_v1.1.0_Extended_With_Example.txt`
- Real corpus: `Research\songs` — 47 UltraStar `.txt` charts + one Rock Band folder (`Yes - Roundabout`) that must be skipped gracefully.

**Key constraint:** real songs deviate from spec but Performous plays them, so the parser must be lenient. Corpus audit found: no file has `#VERSION`; 12 files use comma-decimal BPM (`293,26`); negative `#GAP:-50`; mixed-case/nonstandard tags (`#Cover`, `#MP4` as video, `#AUTHOR`); `#VIDEOGAP` values in seconds with leading space + trailing tab; break lines with two numbers (`- 45 46`) without `#RELATIVE:YES`; `.webm` files referenced via `#MP3:`; LF-only and CRLF endings; Japanese titles/lyrics (CJK); `.avi` videos (Creed).

## Tech Stack: Tauri 2 + TypeScript (Svelte + Vite), Vitest

Why (evaluated Godot 4, C# WPF/WinUI, Electron/Tauri, Python, C++/SDL):
- **Codecs decide it.** Corpus needs mp3, mp4/h264, webm/vp9, ogg. WebView2 (Chromium, preinstalled on Win10/11) plays all natively via `<audio>`/`<video>`. Godot 4 can't play mp4/webm (Theora only). WPF/Media Foundation lacks reliable webm. C++/ffmpeg means hand-written AV-sync.
- **CJK text rendering free** via browser text stack (Japanese songs in corpus).
- **Tiny distribution:** Tauri portable exe ~8–12 MB; `tauri build` also emits an NSIS installer with WebView2 bootstrapper. Electron would be ~90 MB.
- **Rust stays small:** Tauri fs plugin for scanning, asset protocol (`convertFileSrc`, HTTP range → video seeking) for media. All app logic in TypeScript except one contained Rust module: the LAN queue HTTP server (~150 lines of axum).
- `.avi` plays nowhere without ffmpeg → graceful fallback: skip video, show `#BACKGROUND`/cover image (Performous does the same).
- Cross-platform (macOS/Linux) comes essentially free.

## Architecture

```
karaoke/
├─ src-tauri/            # Rust: window, fs scope, asset protocol, build config
│  └─ src/remote.rs      # axum LAN server: static remote UI + /api/songs + /api/queue
├─ remote-ui/            # tiny mobile-first static page (plain HTML/TS, embedded in binary)
├─ src/
│  ├─ parser/
│  │  ├─ ultrastar.ts    # text -> ParsedSong (pure, no I/O — testable in Node)
│  │  ├─ encoding.ts     # UTF-8 (strip BOM); CP1252 fallback only on UTF-8 decode error
│  │  └─ types.ts
│  ├─ library/
│  │  ├─ scanner.ts      # recursive walk, find *.txt, header-only fast parse, mtime cache
│  │  └─ index.ts        # search/filter artist+title, case/width-insensitive (CJK-friendly)
│  ├─ playback/
│  │  ├─ clock.ts        # SongClock; beat<->ms; single source of timing truth
│  │  └─ media.ts        # <audio>/<video> mgmt, VIDEOGAP sync, START/END, avi fallback
│  ├─ render/
│  │  ├─ lyricsRenderer.ts  # canvas: phrases, per-syllable fill, duet lanes, note-type styling
│  │  └─ layout.ts          # measureText layout, font autoscale, cache
│  ├─ queue/
│  │  └─ queue.ts        # play queue: local adds + remote adds (Tauri events), auto-advance
│  ├─ screens/           # SongList.svelte, Sing.svelte, End.svelte (+ queue sidebar)
│  └─ app.ts             # router + keyboard (Space pause, ←/→ seek ±5s, Tab/button skip → next in queue, Esc quit)
└─ tests/corpus.test.ts  # golden tests over Research\songs
```

### Data model (parser/types.ts)

```ts
type NoteType = 'normal' | 'golden' | 'freestyle' | 'rap' | 'rapGolden'; // : * F R G
interface Note   { startBeat: number; lengthBeats: number; pitch: number; type: NoteType; text: string; } // text keeps trailing spaces
interface Phrase { notes: Note[]; startBeat: number; endBeat: number; }
interface Voice  { name?: string; phrases: Phrase[]; }        // name from #DUETSINGERPn
interface SongTiming { bpm: number; gapMs: number; videoGapSec: number; startSec?: number; endMs?: number; }
interface ParsedSong { headers: Map<string,string>; title: string; artist: string;
                       audioFile?: string; videoFile?: string; coverFile?: string; backgroundFile?: string;
                       timing: SongTiming; voices: Voice[]; isDuet: boolean; warnings: string[]; }
```

**Timing semantics:** UltraStar BPM is quarter-beats → `msAtBeat(b) = GAP + b * 60000 / (BPM * 4)`. `#VIDEOGAP` shifts video vs audio (normalize: |value| > 1000 → treat as ms, else seconds). `#RELATIVE:YES` converted to absolute beats at parse time — downstream never sees relative mode.

### Parser leniency rules (warnings, never fatal)

1. Split `/\r?\n/`; strip BOM; UTF-8 first, CP1252 only on decode error.
2. Headers: `^#\s*([^:]+)\s*:(.*)$`, uppercase key, trim value (handles `#VIDEOGAP: 23.5\t`). Missing `#VERSION` fine.
3. Numbers: `parseFloat(v.replace(',', '.'))` — accepts `293,26` and `400.5`. Negative GAP allowed.
4. Aliases: `#MP4` → video (if no `#VIDEO`), `#AUTHOR` → creator. Unknown tags kept + warned, never rejected.
5. Note regex `^([:*FRG])\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s(.*)$` — exactly one space before text so lyric spacing survives. Negative pitch OK.
6. Break lines `- 45` or `- 45 46`: absolute mode ignores second number (warn); relative mode uses it as new origin.
7. `P1`/`P2` switch voice; `E` ends body, trailing garbage ignored.
8. Not-UltraStar detection: no `#TITLE`/`#ARTIST` and no parsable notes → scanner skips folder (handles `Yes - Roundabout`).
9. Media resolved case-insensitively in song dir; `#MP3:*.webm` fine (element ignores extension).

### Playback

- Audio-only: hidden `<audio>` is clock master.
- Audio + video: `<audio>` master, muted `<video>` slaved — per rAF tick, if drift > 0.15s, correct `video.currentTime`; pause/play lockstep.
- Video decode error / `.avi` → tear down video, show background image behind canvas. Never blocks singing.

### Lyrics renderer

- Current + next phrase per voice. Solo: bottom third. Duet: P1 bottom lane, P2 top lane, per-voice colors, singer names at lane edge.
- Active syllable: progressive gradient fill by `(now - noteStartMs)/noteDurMs` + slight scale bounce.
- Note-type styling only: golden = gold fill, freestyle = italic/dim, rap = distinct color. Pitch ignored.
- Gaps > ~4s between phrases: countdown indicator.
- **HUD, top-left:** time remaining in the song (mm:ss, counts down) + progress bar (scales with window). Always visible during singing, drawn on the lyrics canvas.
- **Display offset:** +/- keys during singing shift lyrics/video vs audio in 50 ms steps (persisted) — compensates beamer/TV display latency where audio plays immediately but the image lags.

### Remote queue (LAN web page)

- **Server:** axum in `src-tauri/src/remote.rs`, bound to `0.0.0.0`, port 7777 (configurable, fallback to next free). Shared `Arc<Mutex<AppState>>` holds library snapshot + queue.
  - `GET /` → static mobile-first page (bundled into the binary via `include_dir`/`rust-embed`)
  - `GET /api/songs?q=` → library JSON (id, artist, title, isDuet, hasVideo; cover thumbnails via `GET /api/cover/:id`)
  - `GET /api/queue` → current queue + now playing
  - `POST /api/queue` `{songId, singerName?}` → append; emits Tauri event `queue-updated` to the desktop frontend
  - `POST /api/skip` → skip currently playing song (desktop advances to next queued or song list)
- **Frontend link:** after library scan, frontend pushes snapshot via `set_library` command; queue lives in Rust state as the single source of truth, frontend mirrors via events; local (desktop) adds go through the same command path.
- **Guest access:** app shows `http://<LAN-IP>:7777` + QR code on the song-list screen. No auth (party LAN); server never exposes filesystem paths, only ids.
- **Windows note:** first run triggers a firewall allow prompt (private network) — mention in README; NSIS can add the rule optionally.

## Milestones

- [x] **M0 — Skeleton:** `npm create tauri-app` (TS+Vite+Svelte), fs scope + asset protocol, Vitest wired.
  *Verify:* `npm run tauri dev` opens window; dummy test green.
- [x] **M1 — Parser + golden tests:** full lenient parser (all rules above, RELATIVE mode, duet P-markers).
  *Verify:* all 47 corpus files parse without throwing; snapshot per file; targeted asserts (see Testing); Roundabout classified non-UltraStar.
- [x] **M2 — Audio + solo lyrics:** SongClock, `<audio>` playback, canvas renderer, pause/seek/quit.
  *Verify:* Proud Mary end-to-end; `Crystal King - Ai wo torimodose!!` (CJK render); `Creed - My sacrifice` (comma BPM) in sync.
- [x] **M2.5 — Sing HUD:** top-left remaining time (mm:ss countdown) + progress bar.
  *Verify:* play any song: timer counts down to 0:00 at song end; bar fills left→right; seeking updates both instantly.
- [ ] **M3 — Video:** sync, VIDEOGAP normalize, `#MP4` alias, avi fallback, START/END.
  *Verify:* BLACKPINK mp3+mp4 lipsync; Matsumoto Bon Bon (`#MP4`, `23.5\t` gap); `Creed - Higher` avi → jpg fallback; Creepy Nuts webm audio.
- [ ] **M3.5 — AVI auto-transcode:** detect `.avi` video → automatic background convert via bundled ffmpeg sidecar (`-c:v libx264 -preset veryfast -crf 20` → mp4 cached next to song; try hw encoder first, CPU fallback). Kicks off during library scan and again on queue if missing; "preparing video…" spinner + image fallback only if playback starts before convert finishes. SD avi ≈ 15-30 s on modern CPU, <10 s with NVENC/QuickSync.
  *Verify:* fresh scan of `Research\songs` converts Creed avis unattended; `Creed - Higher` plays with video; second play instant (cache hit).
- [x] **M4 — Duet:** two lanes, per-voice colors, singer names.
  *Verify:* Bling-Bang-Bang-Born shows "Main vocals"/"Adlibss" lanes with independent highlighting; solo songs still single-lane.
- [x] **M5 — Library UI:** *(user-verified; scan cache deferred — full rescan on start is fast at current library size)* scan, cover grid, search, screen flow, scan cache.
  *Verify:* point at `Research\songs`: 47 entries, Roundabout absent, "creepy" → 5 hits, "オトノケ" → found.
- [x] **M6 — Queue + LAN remote:** *(API + autostart + skip verified over HTTP locally; phone-on-Wi-Fi test pending)* queue engine with auto-advance **and skip** (skip current song mid-play → next in queue, or back to song list if queue empty; keyboard shortcut + on-screen button + `POST /api/skip` from remote page), axum server, remote web page, QR/URL display.
  *Verify:* phone on same Wi-Fi opens page, searches "creed", queues 2 songs; desktop plays them in order; skipping mid-song jumps to next queued song; local + remote adds interleave correctly.
- [x] **M7 — Packaging:** *(installer 28.7 MB + portable zip 40.6 MB in dist\; release exe verified — window + LAN API. Clean-VM test + first-run icon polish pending)* NSIS installer + portable zip, icon, first-run folder picker.
  *Verify:* portable exe on clean VM plays a video song; second device can queue via LAN page; zip ~5–8 MB.

### Linux support

**Goal:** Windows stays zero-install (WebView2 bundles codecs). Linux may require system packages, as long as the app/README says clearly what to install and why. Scope: **Debian/Ubuntu only** for this pass (Fedora needs RPM Fusion for patent codecs — deferred, messier). Bundle both `.deb` and `.AppImage`. Missing-codec errors get a Linux-specific hint in the existing error UI, not a new startup probe.

Rust backend (`src-tauri/src/*.rs`) is already structurally cross-platform (`Path`/`PathBuf`, `app.path().app_data_dir()`, no Windows-only crates; the one `windows_subsystem` attribute is already `cfg`-gated) — no fundamental Rust rework needed. Real blockers: frontend path-joining hardcodes `\\`, Tauri config only targets `nsis`, no Linux ffmpeg sidecar, no Linux release script, no Linux codec guidance.

- [x] **M8 — Cross-platform path joins:** add a shared `joinPath()` helper (new `src/lib/util/path.ts`, forward-slash join, collapse duplicate separators); replace every hardcoded `${dir}\\${file}` join in `src/lib/library/scanner.ts` (~144, 161, 173 — 161 also needs to split on both `/` and `\`, matching the existing dual-separator pattern at scanner.ts:138/media.ts:116), `src/lib/playback/media.ts` (~38, 71), `src/lib/library/loudness.ts` (~119), `src/lib/playback/transcode.ts` (~14, 18, 29, 33).
  *Verify:* `npm test` green incl. new `src/lib/util/path.test.ts`; `npm run tauri dev` on Windows still plays a video song, an avi-transcode song, and shows cover art (no regression).
- [x] **M9 — Linux bundle targets + ffmpeg sidecar (config landed; binary/full build untested — no Linux machine in this session):** `tauri.conf.json` `"targets": ["nsis"]` → `["nsis", "deb", "appimage"]`; add Linux static ffmpeg at `src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu` (untracked, from BtbN's `ffmpeg-builds` releases, mirroring gyan.dev for Windows); confirm `additionalBrowserArgs` (WebView2-only field) is harmlessly ignored by WebKitGTK.
  *Verify:* on Linux, `npm run tauri build` produces `.deb` + `.AppImage`; install the deb, launch, avi-transcode song plays (sidecar resolves).
- [x] **M10 — Linux release script (written, untested — no Linux machine in this session):** `scripts/release.sh` (bash), parallel to `release.ps1` but fully independent (never calls it or is called by it) — fetches/updates the Linux ffmpeg sidecar, runs `npm run tauri build`, copies `.deb`/`.AppImage` into `dist/` with version-stamped names. Build on Ubuntu 22.04/Debian 12 (or a pinned Docker image) to keep the glibc/webkitgtk floor low.
  *Verify:* clean Ubuntu 22.04 run produces both artifacts; `dpkg -I` shows sane deps; AppImage runs via `--appimage-extract-and-run` without FUSE.
- [x] **M11 — Linux codec-error guidance + README:** extend `describeMediaError` (`src/lib/playback/media.ts`) so a Linux `MEDIA_ERR_DECODE`/`MEDIA_ERR_SRC_NOT_SUPPORTED` shows an actionable hint by file extension (`.mp3`/`.mp4`/`.avi` → `gstreamer1.0-plugins-ugly gstreamer1.0-libav`) instead of a generic message, pointing to README for the full list. Add **Linux** subsection to README: build prereqs (`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`), runtime codec packages (`gstreamer1.0-plugins-good/-bad/-ugly gstreamer1.0-libav`), LAN-remote troubleshooting (`sudo ufw allow <port>/tcp` — no OS firewall prompt like Windows has).
  *Verify:* fresh Ubuntu VM with only default GStreamer plugins shows the hint on MP3/MP4 playback; works after installing suggested packages.
- [ ] **M12 — Linux manual verification checklist:** deb install+launch, AppImage launch, folder picker, MP3+MP4 lipsync, avi auto-transcode, cover fallback chain, phone remote over LAN (after `ufw allow`), loudness normalization, F11 fullscreen, pause/quit overlay, codec-missing hint on minimal-GStreamer VM.
  *Verify:* checklist green on an Ubuntu/Debian VM; Fedora best-effort only.

Post-v1 backlog: playlist persistence, background slideshow, medley preview, singer-name announcements between songs.

## Testing

- **Golden corpus tests** (kept green forever): glob `Research/songs/**/*.txt` in Node/Vitest, snapshot `{title, artist, bpm, gapMs, voiceCount, phraseCount, noteCount, warnings}` per file.
- **Targeted real-file asserts:** My sacrifice → `videoGapSec === -0.3`; MatsumotoBonBon → video from `#MP4`, gap `23.5` despite whitespace; Bling-Bang-Bang-Born → `isDuet`, voice names, `.webm` audio; Filthy Frank `notes-fixed.txt` → `#AUTHOR` mapped + `#GAP:-50`; Roundabout → non-UltraStar.
- **Synthetic unit tests** (inline string fixtures): comma vs dot BPM, negative GAP, `#Cover` case, `- 45 46` absolute, full `#RELATIVE:YES` conversion, all 5 note types, negative pitch, trailing-space lyric, LF vs CRLF, BOM strip, CP1252 fallback.
- **Timing math tests:** `msAtBeat` vs hand-computed values.
- **Remote API tests:** POST /api/queue → appears in GET /api/queue; unknown songId → 404.
- **Manual playback checklist** per milestone (AV sync by eye/ear).
- **Linux support (M8–M12):** `joinPath()` gets a unit test (`src/lib/util/path.test.ts`); full `npm test` re-run as part of M8's gate to catch regressions from the join-site refactor. M9–M12 (packaging, release script, runtime codec behavior) are manual-checklist only — no Linux desktop-with-webview CI exists in this project.

## Packaging

- `tauri build` → NSIS installer (`*-setup.exe`, WebView2 bootstrapper included) + bare exe zipped as portable. Portable mode: settings/cache next to exe when `portable` marker file present, else `%APPDATA%`.
- Size: exe ~8–12 MB + bundled ffmpeg sidecar ~25 MB → portable zip ~30–35 MB, installer similar. Playback codecs come from WebView2; ffmpeg only for avi transcode. Songs never bundled; folder picker on first run.

## Risks

- Asset-protocol streaming quirk with huge mp4s → range requests are the verified pattern; fallback: serve media from the axum server already in the app.
- Two-element AV drift → 0.15s clamp; same-file songs use single `<video>` master path.
- CP1252 false positives → fallback only on hard UTF-8 decode error.
- Windows Firewall blocks LAN server → README instruction + optional NSIS firewall rule; app shows warning if bind fails.
- Linux: GStreamer codec availability varies by distro (Fedora/RHEL exclude patent codecs by default) — can't be solved in-app, mitigated by in-app hint + README (accepted per requirements).
- Linux: building releases on too new a distro raises the glibc/webkitgtk floor for end users → build on Ubuntu 22.04/Debian 12 or a pinned Docker image.
- Linux: AppImage needs FUSE on the end-user machine (or `--appimage-extract-and-run`) → README note.
- Linux: no OS firewall prompt like Windows for the LAN remote server → README `ufw allow <port>/tcp` note only.
- `joinPath()` refactor (M8) touches 5 frontend files — regression risk on Windows if forward-slash joins misbehave; mitigated by M8's Windows manual-verify gate.
- `release.ps1`/`release.sh` are independent and can drift (version bump, ffmpeg update pattern) — document the expectation to mirror changes conceptually, without ever calling one from the other.

## Critical files

- `src/parser/ultrastar.ts` — lenient parser (project core)
- `src/playback/clock.ts` — all timing correctness
- `src/render/lyricsRenderer.ts` — syllable highlight + duet lanes
- `src/library/scanner.ts` — scan, skip non-UltraStar, cover resolution
- `src/queue/queue.ts` + `src-tauri/src/remote.rs` — queue engine + LAN remote server
- `tests/corpus.test.ts` — golden gate for every parser change
- `src-tauri/tauri.conf.json` — fs scope, asset protocol, build targets
- `src/lib/util/path.ts` — cross-platform path join/dirname (Linux support M8)
- `scripts/release.sh` — Linux release script, parallel to `release.ps1` (Linux support M10)

## Agent workflow

- AI agents make the commits themselves and tag the commit message with a co-author line (e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`).
- Agent must ask user to confirm a change works before committing it — no exceptions for bug fixes or trivial changes.

## Current state (read this first in a new session)

**Version 0.8.0 shipped (Windows only)** — `dist\Karaoke_0.8.0_x64-setup.exe` (28.8 MB) + `dist\Karaoke_0.8.0_portable.zip` (40.8 MB). All milestones M0–M7 done, plus all 12 items from the 2026-07-06 feedback backlog, plus Linux support M8–M11 (code/config/docs; M12 real-Linux verification still open — see Known-open). 141 tests green (`npm test`). Release via `.\scripts\release.ps1` (auto-updates the ffmpeg sidecar from gyan.dev each run; works in PowerShell 5.1 and 7); `scripts\release.sh` is the untested Linux counterpart (M10) — no Linux `.deb`/`.AppImage` published yet. Publisher: "Weebs Software Inc.". App icon from `assets\icon-source.jpg` (rounded corners; regenerate: `npm run tauri icon assets/icon-source.jpg`). Rust edition 2024. GPLv3 licensed; personal identifier removed from `tauri.conf.json`; README expanded with full feature list + Claude Code dev note + Linux sections.

### Features beyond the original plan (all user-requested, all shipped)

**Sing screen**
- HUD top-left: progress bar (scales with window, click/drag to seek) + zero-padded countdown timer (`04:48`)
- Display offset for beamer/TV latency: +/− keys, ±50 ms steps, persisted in localStorage, shifts lyrics AND video vs audio
- Esc = confirmation dialog (pauses; second Esc quits to library, any other key resumes); Tab = skip to next queued
- Countdown dots: only for silences > 5 s, one dot per second in the final 5 s, hits zero on the first note
- "Tab: next song" hint next to the HUD after the last lyric while the outro plays
- Songs play to the natural end of the audio (only explicit #END stops early)
- Lyrics mid-screen for solo; duets P1 bottom (blue) / P2 middle (pink), no name labels
- Syllable gap (~14 % font size) so syllable boundaries are visible (Japanese romaji readability)
- Glyph clip fixes: overhangs (j hooks, italics, descenders) no longer cut by the sung-fill clip

**Playback robustness (all verified against the real corpus)**
- Autoplay policy disabled via WebView2 browser args (file-dialog delay was voiding the user gesture)
- Media fallback chain: asset URL → blob (with corrupt-ID3 sanitizer, strips junk before first MPEG frame sync) → ffmpeg transcode cached as `<name>.karaoke.mp3/.mp4` (Creed "mp3s" are MPEG Layer II — Chromium can't decode them; ~147× realtime conversion)
- Video hidden until metadata loads (kills the small top-left flash); wrong-extension references resolved fuzzily (`papafranku.jpg` → `.jpeg`)

**Library**
- Cards queue on click (no play-now anywhere); no + button; 210 px min card width; titles/artists wrap fully (no ellipsis)
- Cover fallback chain: #COVER (fuzzy) → `[CO]` image → #BACKGROUND → any image in folder
- Duplicate charts deduped (same artist + title + length, e.g. backup copies in subfolders)
- Scan cache for big libraries (7k songs): one Rust call stats every txt (mtime+size), unchanged files come from `%APPDATA%\com.light.karaoke\scan-cache.json`, only new/changed files are parsed (16-way concurrent); non-chart txts cached as misses so they're never re-read
- Search matches artist, title, creator (#CREATOR/#AUTHOR), tags (#TAGS) and genre (#GENRE); case-, width- (CJK) and diacritic-insensitive
- Header row fixed above the scrolling grid; sidebar: centered Phone remote (QR + URL) on top, Queue below with pinned "▶ Play queue" (disabled when empty) and a Clear button; sidebar width draggable 220–600 px, persisted
- F11 fullscreen everywhere
- Session "PLAYED" badge on cards (green, in-memory only, resets on restart)
- **Loudness normalization**: background ffmpeg `loudnorm` measurement (LUFS) of every song after scan — 1 process at a time, paused while a song plays, queued songs jump to the front of the line; results persisted per measurement to `%APPDATA%\com.light.karaoke\loudness.json` via the Rust `save_loudness` command (restart resumes mid-batch). Playback applies `element.volume = clamp(10^((-18 − LUFS)/20), 0.05, 1)` — attenuate-only (target −18 LUFS because YouTube rips sit at ≈−14; quieter songs play at 1.0 unchanged). Header shows "Normalizing volume… X / Y" progress bar until done. Key files: `src/lib/playback/gain.ts`, `src/lib/playback/loudnorm.ts` (stderr JSON parser), `src/lib/library/loudness.ts` (TS scheduler), `measureLoudness` in `transcode.ts`, `src-tauri/src/loudness.rs` (persistence).
  **Hard-won gotcha:** persistence originally went through JS plugin-fs read-modify-write of scan-cache.json — invoke *responses* can be silently dropped while the webview is saturated right after startup (covers loading), leaving awaits pending forever even though the Rust side executed. Anything that must survive during busy phases: use a fire-and-forget Rust command, never chained JS fs I/O.
- Phone remote shows a small green ✓ after titles of songs already sung this session (`GET /api/played`, polled with the queue; Rust tracks played txt-paths in `queue_next`)

**Queue + phone remote**
- Desktop is the only place playback starts (Play queue); phone adds never auto-play
- Auto-advance between songs with a 3 s "UP NEXT" intermission listing the queue; Esc there returns to the library, queue intact
- Start-time ETAs (`+3:00`) on every queue position (intermission + phone), from scan-time duration estimates (last lyric + 15 s) plus the live remaining time the sing screen pushes every 5 s
- Phone page: Songs/Queue tabs; queue shows now playing, artist — singer, ETA, and × remove buttons (`DELETE /api/queue/:uid`); singer name remembered in the phone's localStorage
- API: GET /api/songs?q= (searches creator/tags too), GET/POST /api/queue, DELETE /api/queue/:uid, POST /api/skip, GET /api/cover/:id; ids only, no file paths exposed

### Known-open (nice-to-haves, nothing blocking)

- Clean-VM installer test before wide sharing
- Linux support: M8–M11 code/config/docs landed, but **none of it has run on an actual Linux machine yet** (this dev session was Windows-only) — M12's manual verification pass (deb/AppImage install, real playback, codec-hint path) is the remaining gate before calling Linux support real. Fedora/RPM deferred — patent-codec licensing (RPM Fusion) adds friction beyond this pass's scope.
- NSIS "Already installed" upgrade page assessed and rejected (custom template, ~1–2 h + maintenance; silent upgrades work via `setup.exe /S`)
- `Research\songs\songs\` is a manual copy for dedupe testing — excluded from the golden corpus test

## Feedback backlog (2026-07-06)

Investigated against current code; root causes found for all but the reorder/duration/progress-bar features (net-new). Ordered roughly by effort.

- [x] **Golden notes need no special handling** — currently only `isGolden()` in `lyricsRenderer.ts` swaps to a gold fill color; no scoring/behavior difference exists anywhere. Fix: drop the gold color, render golden/rapGolden identically to normal notes. *(Done 2026-07-06: removed `isGolden()`/`golden` color field entirely; all note types render with the lane's normal `sung` color.)*
- [x] **Tag filtering "doesn't work"** — not a matching bug: `filterEntries` (scanner.ts), `remote.rs`, and `remote-ui/index.html` already all match artist+title+creator+tags/genre (tested in `library.test.ts`). Real issue: both search boxes' placeholder text still says "Search artist or title…", hiding the feature. Fix: update placeholder copy in `SongList.svelte` and `remote-ui/index.html`. *(Done 2026-07-06: placeholder now reads "Search artist, title, tags…" in both places.)*
- [x] **Syllable active-note size bump too big** — `lyricsRenderer.ts`: active note renders at `fontSize * 1.08` with no clamp. Fix: shrink multiplier to ~1.03–1.04x. *(Done 2026-07-06: 1.08 → 1.035.)*
- [x] **Syllable fill: instant vs progressive option** — current fill is a hard clip-rect reveal (not actually a gradient despite the code comment), linear with time. Some singers want the whole syllable to light up the instant its timing starts instead. Fix: add a persisted `instantSyllableFill` toggle (same pattern as the display-offset setting) that forces `fillFraction = 1` immediately on note start when enabled. *(Done 2026-07-06: `F` key toggles it during singing, persisted in localStorage, shown in the pause-overlay help text and as a notice on toggle.)*
- [x] **Countdown at song start doesn't trigger** — the >5s-gap countdown logic is shared between first-phrase and mid-song gaps, but the very first phrase has extra failure modes mid-song gaps don't: the rAF loop starts before playback actually begins (currentTime pinned at 0 pre-`play()`), `#START` seeking shifts the timeline without adjusting the gap-from-zero math, and an autoplay-blocked pause overlay can render on top of the dots. Fix: gate the countdown on a `playbackStarted` flag set once real playback begins, and suppress it while the autoplay-block overlay is showing. *(Done 2026-07-06: added `playbackStarted` state (set on `play()` resolving and on manual resume) and a `showCountdown = playbackStarted && !paused` flag threaded into `LaneOptions`; `LyricsLane.render` only draws dots when it's true.)*
- [x] **Main menu flashes between songs** — `+page.svelte`'s `songFinished()` sets `loaded = null` synchronously but only flips `intermission = true` after `await refreshQueue()` resolves; in between, the template's `{:else}` branch (library/`SongList`) is briefly reachable and renders. Same shape exists in `playNext()`'s empty-queue path. Slower IPC (e.g. mid-normalization on a 7000-song library) widens the visible window but the bug isn't size-dependent. Fix: set `intermission = true` synchronously alongside `loaded = null` (or add an explicit transitional state) so the library branch is never reachable during the gap. *(Done 2026-07-06: added a `transitioning` flag spanning the whole `songFinished()` async gap; template gates the library branch behind it.)*
  - **Follow-up same day — flash moved to after the intermission screen:** `transitioning` only covered `songFinished()`'s own execution, which returns almost immediately once the 3s intermission timer is scheduled — it did NOT cover the gap between the timer firing (`intermission = false`) and `playNext()` actually finishing (`loaded` being set), so the library screen could still flash there. The `setTimeout` callback now sets `transitioning = true` before calling `playNext()` and clears it in a `.finally()`.
- [x] **AppData folder button** — everything needed is already present (opener + shell plugins registered, `opener:default` permission granted, `@tauri-apps/plugin-opener` already a dependency); no Rust changes needed. Fix: add a button next to "Change song folder…" calling `openPath(await appDataDir())`. *(Done 2026-07-06: "Open app data folder…" button added in `SongList.svelte` header. Follow-up same day: button did nothing — `opener:default` only covers `open_url`/`reveal_item_in_dir`, not `open_path`; added a scoped `opener:allow-open-path` permission for `$APPDATA`.)*
- [x] **Show song length before queuing** — `durationMs` already exists on library entries and remote song data (currently only used for queue ETA math) but isn't rendered anywhere before a song is queued. Fix: show `mm:ss` on desktop library cards and the phone Songs-tab list. *(Done 2026-07-06: `mm:ss` shown under the artist on desktop cards and in the phone Songs-tab list.)*
- [x] **Queue drag-to-reorder (desktop + phone)** — no reorder capability exists on either side; queue order is a plain `Vec<QueueItem>`/`QueueItem[]`. Fix: new Rust `queue_move(uid, new_index)` command + `PATCH /api/queue/{uid}` route (mirrors the existing `queue_remove` pattern), a `moveInQueue()` TS wrapper, native HTML5 drag-and-drop on the desktop sidebar `<li>`s, and pointer-based drag (native DnD is poor on mobile) on the phone Queue tab. *(Done 2026-07-06: shared `move_item` helper backs both the Tauri command and the HTTP route; desktop uses a drag-handle + native DnD; phone uses pointer events with live DOM reordering, pausing the 4s queue poll while a drag is in progress so the list doesn't jump under the user's finger.)*
  - **Follow-up same day — desktop drag did nothing (items highlighted, never moved):** Tauri's native OS drag-drop interception (`dragDropEnabled`, on by default) swallows HTML5 dragover/drop events in the webview. Worked around initially with `"dragDropEnabled": false`, but see next entry — drag was dropped entirely, so this override was reverted.
  - **Follow-up same day — phone reorder still unreliable after the above:** race in `refreshQueue()` (4s poll vs. a drag-triggered refresh, older fetch could resolve later and clobber the reordered list) was fixed with a `queueGen` monotonic counter, but touch drag remained flaky in practice.
  - **Final approach (still 2026-07-06): replaced drag-and-drop entirely with ▲/▼ move buttons** on both the desktop sidebar and the phone Queue tab — same `queue_move`/`PATCH /api/queue/{uid}` backend, just triggered by a button click with `newIndex = index ∓ 1` instead of a drag gesture. Simpler and far more reliable on touchscreens than pointer-drag reimplementations of native DnD. The `dragDropEnabled` override and all pointer/DnD event code were removed as dead weight.
- [x] **Scanning progress bar** — the initial library scan is one blocking Rust call + a 16-way concurrent parse pool with zero progress reporting (UI shows static "Scanning library…" text). The loudness-normalization feature already has the exact pattern needed (a `{done,total}` store driving a fill bar) — reuse it: add a `scanProgress` store, increment `done` as the parse pool completes each file, render the same bar style while scanning. *(Done 2026-07-06: `scanProgress` writable in `scanner.ts` tracks the new/changed-file parse pass — the only part that takes real time, since cache hits are near-instant — rendered as a header fill bar identical in style to the loudness one.)*
- [x] **Skip instrumental sections** — long gaps with no lyrics in either voice (>15s, e.g. guitar solos) are dead time; want a keypress to jump to the next vocal section, like the existing "Tab: next song" outro skip. Approach: new `findInstrumentalGaps` helper in `clock.ts` merges both voices' phrase spans (duet: instrumental only where BOTH are silent) and reports gaps >15s, bounded so it doesn't overlap the existing outro-skip window. Tab becomes context-sensitive in `Sing.svelte` — mid-gap it seeks to 5s before the next vocal (reusing the existing `master().currentTime = X` seek pattern, so the current >5s countdown-dots UI plays the lead-in naturally); otherwise it keeps skipping to the next song as today. HUD shows a "Tab: skip instrumental" hint during a gap, same style as the outro hint. *(Done 2026-07-06: implemented as designed; 6 new unit tests for `findInstrumentalGaps` cover solo/duet gap merging, threshold edge, intro gap, and no-trailing-outro-gap.)*
  - **Follow-up same day — Tab appeared dead near the end of a gap:** the 5s-lead-in clamp (`Math.max(nowMs(), endMs - 5000)`) became a no-op once already within the final ~4s of the gap, but the hint stays up until `endMs - 1000`, so Tab did nothing while still claiming to work. Fixed to jump straight to the vocal start (no lead-in) when there isn't 5s of gap left instead of clamping backward to "now".
  - **Follow-up same day — hint should disappear once the countdown dots take over:** the hint stayed visible until 1s before the gap ended, overlapping the last-5s countdown dots. Now hidden once `t >= currentGap.endMs - 5000`, yielding the space to the dots (Tab, pressed anyway, still jumps straight to the vocal start per the fix above).
- [x] **Webpage: last song unreachable while scrolling** — no fixed-height clipping found; the phone page's bottom padding (`4.4rem`, a static estimate for the fixed tab bar) can undershoot on devices with safe-area insets (e.g. iPhone home indicator). Fix: `padding-bottom: calc(4.4rem + env(safe-area-inset-bottom))`, verify on an actual phone. *(Done 2026-07-06: added safe-area-aware padding to body and the fixed tab bar; still worth a real-phone check.)*
- [x] **Esc should show a full shortcuts/settings overview, not just "quit?"** — the quit-confirmation dialog only listed Esc/any-key; the pause overlay already had the full shortcut list + current settings (display offset, syllable fill mode) but that only shows on Space-pause, not Esc. Fix: added the same shortcut list plus live settings values to the quit-confirmation dialog in `Sing.svelte`, as a small table. *(Done 2026-07-06.)*

## Progress log

- 2026-07-03 — Plan written; corpus audited; stack chosen (Tauri 2 + TS). M0–M2 built and user-verified same day (parser with 47-file golden corpus, audio + syllable-fill lyrics).
- 2026-07-03 — Playback hardening from live user testing (autoplay policy, mp3 sanitizer, ffmpeg sidecar transcode = M3.5 pulled forward). M5 library, M6 queue + LAN remote (phone-verified), M7 packaging all landed. Releases 0.1.0 → 0.4.0 shipped through `scripts\release.ps1`. Feature list above grew through ~30 user feedback rounds in the same session.
- 2026-07-03 — Loudness normalization (background LUFS batch + volume gain, −18 LUFS target, progress bar in library header) and session PLAYED badge. 118 tests green. Not yet user-verified by ear; manual checklist in `.claude/plans/what-things-to-add-sprightly-dusk.md`.
- 2026-07-04 — Fixed "normalization restarts from zero after app restart": persistence moved from JS scan-cache writes (invoke responses silently dropped under startup load → nothing ever hit disk) to Rust `save_loudness` → loudness.json; restart-resume verified live (killed at 23 measured, resumed at 24 six seconds after relaunch). Added ✓ played marker to the phone page (`/api/played`).
- 2026-07-05 — Version 0.6.0 built and shipped (`dist\Karaoke_0.6.0_x64-setup.exe` + portable zip). 118 tests green.
- 2026-07-06 — New feedback round captured (11 items, then a 12th for instrumental-section skip): tag-search placeholder is stale copy not a real bug, menu-flash traced to `songFinished()` state-order race in `+page.svelte`, song-start countdown traced to rAF-vs-playback timing gap — root causes + fix approach for all items in Feedback backlog section above.
- 2026-07-06 — All 12 feedback-backlog items implemented and committed (one commit per item): gold note coloring removed, active-syllable size bump shrunk, search placeholders fixed, appdata-folder button, safe-area padding on the phone page, song duration shown before queuing, library-screen flash fixed via a `transitioning` flag, countdown-at-start fixed via a `playbackStarted` flag, instant/progressive syllable-fill toggle (`F` key), scan progress bar (reusing the loudness store pattern), queue drag-to-reorder on desktop + phone (shared Rust `move_item` + new `PATCH /api/queue/{uid}`), and instrumental-section skip (`findInstrumentalGaps` in `clock.ts`, context-sensitive Tab key). 124 tests green, `cargo check` clean, `svelte-check` clean.
- 2026-07-06 — Version 0.7.0 built and shipped (`dist\Karaoke_0.7.0_x64-setup.exe` + portable zip), bundling all 12 feedback-backlog items above. Also landed: queue side panel toggle (Q key) with canvas resize, full shortcuts/settings overview on Esc, GPLv3 license added, personal identifier stripped from `tauri.conf.json`, README expanded (features + Claude Code dev note). 124 tests green.
- 2026-07-14 — Linux support planned (M8–M12): reversed the earlier "assessed and rejected" call. Audited the Rust backend (already cross-platform clean) and the frontend (5 files with hardcoded `\\` path joins — the real blocker) plus researched WebKitGTK/GStreamer codec realities on Linux. Scope agreed with user: Debian/Ubuntu only this pass, deb + AppImage targets, Windows stays zero-install, Linux codec gaps surfaced via an in-app error hint + README rather than a startup probe. Not yet implemented.
- 2026-07-14 — M8 done: new `src/lib/util/path.ts` (`joinPath`/`dirname`/`basename`, forward-slash join, tolerant of both separators) replaces every hardcoded `\\` join in `scanner.ts`, `media.ts`, `loudness.ts`, `transcode.ts`; `media.ts`'s duplicate local `dirname` removed. 11 new unit tests (`path.test.ts`), 135 tests green, `svelte-check` clean, `npm run tauri dev` on Windows builds and launches with no errors (karaoke.exe stable, killed after verifying).
- 2026-07-14 — M9–M11 landed (session had no Linux machine to verify the packaging/runtime parts on): `tauri.conf.json` targets `["nsis", "deb", "appimage"]` — confirmed via a real `npm run tauri build` on Windows that Tauri silently skips unsupported targets per-platform (still only produces the NSIS installer, no error, no regression). `describeMediaError` (`media.ts`) now appends a GStreamer-install hint on Linux for decode/unsupported-source errors, keyed off `navigator.userAgent` (Android excluded); 6 new tests in `media.test.ts` (141 total, green). New `scripts/release.sh` (bash, `chmod +x`), independent of `release.ps1`, fetches a BtbN linux64-gpl ffmpeg static build and packages `.deb`/`.AppImage` into `dist/` — syntax-checked (`bash -n`) but not run (no Linux box available). README gained a Linux player section (install, GStreamer packages, ufw note, Fedora caveat) and a Linux developer/build-prereqs + release-script section. **Still open before M9–M11 can be checked off for real: an actual Linux build/install/playback pass (M12) — nothing here has run on Linux yet.**
- 2026-07-14 — Version 0.8.0 built and shipped (`dist\Karaoke_0.8.0_x64-setup.exe` + portable zip, Windows only), bundling M8–M11 Linux-support groundwork above. 141 tests green. User has a Hyper-V Ubuntu 22.04 VM in progress to run the M12 checklist (not yet completed this session) — no Linux `.deb`/`.AppImage` published under this version yet.
