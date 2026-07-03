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

Post-v1 backlog: playlist persistence, background slideshow, medley preview, singer-name announcements between songs.

## Testing

- **Golden corpus tests** (kept green forever): glob `Research/songs/**/*.txt` in Node/Vitest, snapshot `{title, artist, bpm, gapMs, voiceCount, phraseCount, noteCount, warnings}` per file.
- **Targeted real-file asserts:** My sacrifice → `videoGapSec === -0.3`; MatsumotoBonBon → video from `#MP4`, gap `23.5` despite whitespace; Bling-Bang-Bang-Born → `isDuet`, voice names, `.webm` audio; Filthy Frank `notes-fixed.txt` → `#AUTHOR` mapped + `#GAP:-50`; Roundabout → non-UltraStar.
- **Synthetic unit tests** (inline string fixtures): comma vs dot BPM, negative GAP, `#Cover` case, `- 45 46` absolute, full `#RELATIVE:YES` conversion, all 5 note types, negative pitch, trailing-space lyric, LF vs CRLF, BOM strip, CP1252 fallback.
- **Timing math tests:** `msAtBeat` vs hand-computed values.
- **Remote API tests:** POST /api/queue → appears in GET /api/queue; unknown songId → 404.
- **Manual playback checklist** per milestone (AV sync by eye/ear).

## Packaging

- `tauri build` → NSIS installer (`*-setup.exe`, WebView2 bootstrapper included) + bare exe zipped as portable. Portable mode: settings/cache next to exe when `portable` marker file present, else `%APPDATA%`.
- Size: exe ~8–12 MB + bundled ffmpeg sidecar ~25 MB → portable zip ~30–35 MB, installer similar. Playback codecs come from WebView2; ffmpeg only for avi transcode. Songs never bundled; folder picker on first run.

## Risks

- Asset-protocol streaming quirk with huge mp4s → range requests are the verified pattern; fallback: serve media from the axum server already in the app.
- Two-element AV drift → 0.15s clamp; same-file songs use single `<video>` master path.
- CP1252 false positives → fallback only on hard UTF-8 decode error.
- Windows Firewall blocks LAN server → README instruction + optional NSIS firewall rule; app shows warning if bind fails.

## Critical files

- `src/parser/ultrastar.ts` — lenient parser (project core)
- `src/playback/clock.ts` — all timing correctness
- `src/render/lyricsRenderer.ts` — syllable highlight + duet lanes
- `src/library/scanner.ts` — scan, skip non-UltraStar, cover resolution
- `src/queue/queue.ts` + `src-tauri/src/remote.rs` — queue engine + LAN remote server
- `tests/corpus.test.ts` — golden gate for every parser change
- `src-tauri/tauri.conf.json` — fs scope, asset protocol, build targets

## Current state (read this first in a new session)

**Version 0.4.0 shipped** — `dist\Karaoke_0.4.0_x64-setup.exe` (28.8 MB) + `dist\Karaoke_0.4.0_portable.zip` (40.7 MB). All milestones M0–M7 done. 100 tests green (`npm test`). Release via `.\scripts\release.ps1` (auto-updates the ffmpeg sidecar from gyan.dev each run; works in PowerShell 5.1 and 7). Publisher: "Weebs Software Inc.". App icon from `assets\icon-source.jpg` (rounded corners; regenerate: `npm run tauri icon assets/icon-source.jpg`). Rust edition 2024.

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

**Queue + phone remote**
- Desktop is the only place playback starts (Play queue); phone adds never auto-play
- Auto-advance between songs with a 3 s "UP NEXT" intermission listing the queue; Esc there returns to the library, queue intact
- Start-time ETAs (`+3:00`) on every queue position (intermission + phone), from scan-time duration estimates (last lyric + 15 s) plus the live remaining time the sing screen pushes every 5 s
- Phone page: Songs/Queue tabs; queue shows now playing, artist — singer, ETA, and × remove buttons (`DELETE /api/queue/:uid`); singer name remembered in the phone's localStorage
- API: GET /api/songs?q= (searches creator/tags too), GET/POST /api/queue, DELETE /api/queue/:uid, POST /api/skip, GET /api/cover/:id; ids only, no file paths exposed

### Known-open (nice-to-haves, nothing blocking)

- Clean-VM installer test before wide sharing
- Linux support assessed and rejected (WebKitGTK codec mess; ~2–3 days if ever wanted)
- NSIS "Already installed" upgrade page assessed and rejected (custom template, ~1–2 h + maintenance; silent upgrades work via `setup.exe /S`)
- `Research\songs\songs\` is a manual copy for dedupe testing — excluded from the golden corpus test

## Progress log

- 2026-07-03 — Plan written; corpus audited; stack chosen (Tauri 2 + TS). M0–M2 built and user-verified same day (parser with 47-file golden corpus, audio + syllable-fill lyrics).
- 2026-07-03 — Playback hardening from live user testing (autoplay policy, mp3 sanitizer, ffmpeg sidecar transcode = M3.5 pulled forward). M5 library, M6 queue + LAN remote (phone-verified), M7 packaging all landed. Releases 0.1.0 → 0.4.0 shipped through `scripts\release.ps1`. Feature list above grew through ~30 user feedback rounds in the same session.
