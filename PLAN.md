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
- [ ] **M4 — Duet:** two lanes, per-voice colors, singer names.
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

## Progress log

- 2026-07-03 — Plan written. Corpus audited (deviation list above). Stack chosen: Tauri 2 + TS. No code yet.
- 2026-07-03 — M0 done (Rust installed, skeleton runs, Vitest green). M1 done (parser, 84 tests, 47-file golden corpus). M2 done and user-verified (audio + syllable-fill lyrics; basic video slave + duet lanes already wired, polish pending in M3/M4).
- 2026-07-03 — Playback hardening from user testing: autoplay policy disabled via WebView2 args; video hidden until sized; corrupt-ID3 mp3 sanitizer; M3.5 pulled forward — ffmpeg sidecar transcodes undecodable media on demand (Creed "mp3" = MPEG Layer II → lame mp3 at ~147×; avi→mp4 path wired but not yet user-verified). Scan-time background convert still open.
- 2026-07-03 — M5 library UI (user-verified, incl. cover fallbacks + fixed scroll layout). M6 queue + LAN phone remote (user-verified from phone; tabbed remote UI, no auto-play on add, songs play to natural end, outro skip hint, Esc keeps queue). Display-offset setting for beamer latency. M7: NSIS installer (28.7 MB) + portable zip (40.6 MB) built in dist\, release exe smoke-tested (window + API). Open: M4 duet visual verify, natural song-end chaining verify, clean-VM install test, scan cache, app icon.
