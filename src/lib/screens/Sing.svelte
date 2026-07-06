<script lang="ts">
  import { onMount } from "svelte";
  import { describeMediaError, loadFileAsBlobUrl, type LoadedSong } from "../playback/media";
  import { transcodeAudioToMp3, transcodeVideoToMp4 } from "../playback/transcode";
  import { songEndMs, timePhrases } from "../playback/clock";
  import { msAtBeat } from "../parser/ultrastar";
  import { reportProgress } from "../queue/queue";
  import { DUET_P2_COLORS, LyricsLane, SOLO_COLORS } from "../render/lyricsRenderer";

  let {
    loaded,
    gain = 1,
    onExit,
    onSkip,
  }: { loaded: LoadedSong; gain?: number; onExit: () => void; onSkip: () => void } = $props();

  let canvas: HTMLCanvasElement;
  let audio: HTMLAudioElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let paused = $state(false);
  // False until the master element actually starts advancing (not just
  // loaded/seeked) — the countdown dots are meaningless while currentTime
  // is still pinned at 0 during the pre-playback window.
  let playbackStarted = $state(false);
  let confirmingQuit = $state(false);
  let error = $state("");
  let videoFailed = $state(false);
  let videoReady = $state(false);
  // svelte-ignore state_referenced_locally
  let audioSrc = $state(loaded.audioUrl);
  // svelte-ignore state_referenced_locally
  let videoSrc = $state(loaded.videoUrl);
  let triedBlobFallback = false;
  let triedAudioTranscode = false;
  let triedVideoTranscode = false;
  let blobUrl: string | undefined;
  let notice = $state("");
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  // Loudness normalization: element volume survives the blob/transcode src
  // swaps (same element), and setting both covers video-master songs.
  $effect(() => {
    if (audio) audio.volume = gain;
    if (video) video.volume = gain;
  });

  // Display latency compensation (beamers/TVs delay the image while audio
  // plays immediately). Positive = draw lyrics/video this many ms earlier.
  const OFFSET_KEY = "karaoke.displayOffsetMs";
  let displayOffsetMs = $state(Number(localStorage.getItem(OFFSET_KEY)) || 0);

  // Some singers prefer the whole syllable to light up the instant its
  // timing starts instead of filling left-to-right.
  const FILL_KEY = "karaoke.instantSyllableFill";
  let instantSyllableFill = $state(localStorage.getItem(FILL_KEY) === "1");

  function toggleSyllableFill() {
    instantSyllableFill = !instantSyllableFill;
    localStorage.setItem(FILL_KEY, instantSyllableFill ? "1" : "0");
    showNotice(`Syllable fill: ${instantSyllableFill ? "instant" : "progressive"}`);
  }

  function adjustOffset(deltaMs: number) {
    displayOffsetMs += deltaMs;
    localStorage.setItem(OFFSET_KEY, String(displayOffsetMs));
    showNotice(
      `Display offset: ${displayOffsetMs > 0 ? "+" : ""}${displayOffsetMs} ms (lyrics ${displayOffsetMs >= 0 ? "earlier" : "later"})`,
    );
  }

  function showNotice(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 2500);
  }

  // The component is remounted per song, so capturing the initial prop value is intended.
  // svelte-ignore state_referenced_locally
  const song = loaded.song;
  const timing = song.timing;
  const endMs = songEndMs(song);
  // Audio is the clock master; when there is no separate audio file but there
  // is a video, the video element is the master instead.
  // svelte-ignore state_referenced_locally
  const videoIsMaster = !loaded.audioUrl && !!loaded.videoUrl;

  const lanes = song.voices.map(
    (voice) => new LyricsLane(timePhrases(voice, timing), timing),
  );

  // When all lyrics are sung the outro keeps playing; from that point on the
  // HUD offers the skip shortcut.
  const lastLyricEndMs = Math.max(
    0,
    ...song.voices.map((v) => {
      const last = v.phrases[v.phrases.length - 1];
      return last ? msAtBeat(timing, last.endBeat) : 0;
    }),
  );

  function master(): HTMLMediaElement | undefined {
    return videoIsMaster ? video : audio;
  }

  function nowMs(): number {
    const m = master();
    return m ? m.currentTime * 1000 : 0;
  }

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rawT = nowMs();
    // Visual layers render earlier by the configured display offset.
    const t = rawT + displayOffsetMs;

    // Slave the muted video to the audio clock.
    if (!videoIsMaster && video && audio && !videoFailed && videoReady) {
      const target = audio.currentTime + timing.videoGapSec + displayOffsetMs / 1000;
      if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      if (audio.paused !== video.paused) {
        if (audio.paused) video.pause();
        else void video.play().catch(() => {});
      }
    }

    const baseFontSize = Math.max(24, Math.round(h / 14));
    const showCountdown = playbackStarted && !paused;
    if (lanes.length > 1) {
      // P1 bottom, P2 mid-screen; voices distinguished by color only.
      lanes[0].render(ctx, t, w, {
        centerY: h * 0.82,
        colors: SOLO_COLORS,
        baseFontSize,
        showCountdown,
        instantSyllableFill,
      });
      lanes[1].render(ctx, t, w, {
        centerY: h * 0.45,
        colors: DUET_P2_COLORS,
        baseFontSize,
        showCountdown,
        instantSyllableFill,
      });
    } else if (lanes.length === 1) {
      lanes[0].render(ctx, t, w, {
        centerY: h * 0.45,
        colors: SOLO_COLORS,
        baseFontSize,
        showCountdown,
        instantSyllableFill,
      });
    }

    drawHud(ctx, rawT, w, h);

    if (endMs !== undefined && rawT >= endMs) finish();
  }

  // Progress bar hit box (CSS px), updated each frame by drawHud for drag-seek.
  let barRect = { x: 0, y: 0, w: 0, h: 0 };
  let draggingBar = false;

  function currentDurationMs(): number {
    const m = master();
    return Math.min(
      endMs ?? Number.POSITIVE_INFINITY,
      m?.duration ? m.duration * 1000 : Number.POSITIVE_INFINITY,
    );
  }

  function drawHud(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
    const durationMs = currentDurationMs();
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;

    const remaining = Math.max(0, durationMs - t);
    const totalSec = Math.ceil(remaining / 1000);
    const text = `${String(Math.floor(totalSec / 60)).padStart(2, "0")}:${String(totalSec % 60).padStart(2, "0")}`;

    // Scale with the window: bar is a quarter of the width, height follows.
    const barX = Math.round(w * 0.012) + 8;
    const barY = Math.round(h * 0.025) + 8;
    const barW = Math.max(200, Math.round(w * 0.25));
    const barH = Math.max(12, Math.round(h * 0.022));
    barRect = { x: barX, y: barY, w: barW, h: barH };
    const fontSize = Math.max(18, Math.round(barH * 1.35));
    const frac = Math.min(1, t / durationMs);
    const r = barH / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, barX - 2, barY - 2, barW + 4, barH + 4, r + 1);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    roundRect(ctx, barX, barY, barW, barH, r);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = "#37b6ff";
      roundRect(ctx, barX, barY, Math.max(barH, barW * frac), barH, r);
      ctx.fill();
    }

    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(text, barX + barW + 12, barY + barH / 2);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(text, barX + barW + 12, barY + barH / 2);

    // Outro: all lyrics sung, offer the skip shortcut next to the bar.
    if (lastLyricEndMs > 0 && t >= lastLyricEndMs) {
      const hint = "Tab: next song";
      const timeWidth = ctx.measureText(text).width;
      ctx.font = `600 ${Math.round(fontSize * 0.8)}px "Segoe UI", system-ui, sans-serif`;
      const x = barX + barW + 12 + timeWidth + 24;
      ctx.strokeText(hint, x, barY + barH / 2);
      ctx.fillStyle = "#37b6ff";
      ctx.fillText(hint, x, barY + barH / 2);
    }
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  // Natural song end and skip continue with the queue; Esc leaves to the list.
  function finish() {
    cancelAnimationFrame(raf);
    onSkip();
  }

  function quit() {
    cancelAnimationFrame(raf);
    onExit();
  }

  function togglePause() {
    const m = master();
    if (!m) return;
    if (m.paused) {
      void m.play();
      paused = false;
      playbackStarted = true;
    } else {
      m.pause();
      paused = true;
    }
  }

  function seek(deltaSec: number) {
    const m = master();
    if (!m) return;
    m.currentTime = Math.max(0, m.currentTime + deltaSec);
  }

  function onKey(e: KeyboardEvent) {
    // Quit confirmation: second Esc quits, anything else cancels and resumes.
    if (confirmingQuit) {
      e.preventDefault();
      if (e.key === "Escape") {
        quit();
      } else {
        confirmingQuit = false;
        const m = master();
        if (m?.paused) {
          void m.play();
          paused = false;
        }
      }
      return;
    }
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePause();
        break;
      case "ArrowLeft":
        seek(-5);
        break;
      case "ArrowRight":
        seek(5);
        break;
      case "+":
      case "=":
        adjustOffset(50);
        break;
      case "-":
      case "_":
        adjustOffset(-50);
        break;
      case "f":
      case "F":
        toggleSyllableFill();
        break;
      case "Tab":
        e.preventDefault();
        finish(); // skip to next in queue
        break;
      case "Escape":
        confirmingQuit = true;
        master()?.pause();
        break;
    }
  }

  const BAR_HIT_PAD = 10;

  function barHit(e: PointerEvent): boolean {
    return (
      e.offsetX >= barRect.x - BAR_HIT_PAD &&
      e.offsetX <= barRect.x + barRect.w + BAR_HIT_PAD &&
      e.offsetY >= barRect.y - BAR_HIT_PAD &&
      e.offsetY <= barRect.y + barRect.h + BAR_HIT_PAD
    );
  }

  function seekToPointer(e: PointerEvent) {
    const m = master();
    const durationMs = currentDurationMs();
    if (!m || !Number.isFinite(durationMs) || durationMs <= 0 || barRect.w === 0) return;
    const frac = Math.min(1, Math.max(0, (e.offsetX - barRect.x) / barRect.w));
    m.currentTime = (frac * durationMs) / 1000;
  }

  function onPointerDown(e: PointerEvent) {
    if (!barHit(e)) return;
    draggingBar = true;
    canvas.setPointerCapture(e.pointerId);
    seekToPointer(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (draggingBar) {
      seekToPointer(e);
    } else {
      canvas.style.cursor = barHit(e) ? "pointer" : "default";
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!draggingBar) return;
    draggingBar = false;
    canvas.releasePointerCapture(e.pointerId);
  }

  function onMediaReady() {
    const m = master();
    if (!m) return;
    if (timing.startSec) m.currentTime = timing.startSec;
    void m
      .play()
      .then(() => {
        playbackStarted = true;
      })
      .catch((e) => {
        // Autoplay can be blocked when too much time passed since the last user
        // gesture (file dialog browsing). Fall back to the pause overlay.
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          paused = true;
        } else {
          error = `Could not start playback: ${e}`;
        }
      });
  }

  function onVideoError() {
    // Undecodable container (avi/xvid): convert once in the background and
    // swap in the cached mp4; the image fallback shows meanwhile.
    if (!triedVideoTranscode && loaded.videoFileName) {
      triedVideoTranscode = true;
      videoFailed = true;
      void transcodeVideoToMp4(loaded.dir, loaded.videoFileName)
        .then((url) => {
          videoReady = false;
          videoSrc = url;
          videoFailed = false;
        })
        .catch(() => {
          // Video is optional: stay on the image fallback.
        });
      return;
    }
    videoFailed = true;
  }

  function onVideoReady() {
    videoReady = true;
    if (videoIsMaster) onMediaReady();
  }

  function onAudioError() {
    const detail = audio ? describeMediaError(audio) : "unknown error";
    // The asset protocol occasionally fails to stream a file; retry once by
    // reading the bytes directly and playing from a blob URL.
    if (!triedBlobFallback && loaded.audioFileName) {
      triedBlobFallback = true;
      void loadFileAsBlobUrl(loaded.dir, loaded.audioFileName)
        .then((url) => {
          blobUrl = url;
          audioSrc = url;
        })
        .catch((e) => {
          error = `Could not load audio (${detail}); direct read also failed: ${e}`;
        });
      return;
    }
    // Still undecodable: the codec itself is unsupported (e.g. MPEG Layer II
    // in a .mp3). Convert once with ffmpeg and play the cached result.
    if (!triedAudioTranscode && loaded.audioFileName) {
      triedAudioTranscode = true;
      clearTimeout(noticeTimer);
      notice = "Converting audio…";
      void transcodeAudioToMp3(loaded.dir, loaded.audioFileName)
        .then((url) => {
          notice = "";
          audioSrc = url;
        })
        .catch((e) => {
          notice = "";
          error = `Could not convert audio (${detail}): ${e}`;
        });
      return;
    }
    error = `Could not load audio: ${loaded.song.audioFile ?? "unknown file"} (${detail})`;
  }

  onMount(() => {
    raf = requestAnimationFrame(frame);
    // Feed the remote server the remaining time for queue ETAs.
    const progressTimer = setInterval(() => {
      const durationMs = currentDurationMs();
      if (Number.isFinite(durationMs) && durationMs > 0) {
        void reportProgress(Math.max(0, durationMs - nowMs())).catch(() => {});
      }
    }, 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(progressTimer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="sing">
  {#if videoSrc && !videoFailed}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      class:ready={videoReady}
      src={videoSrc}
      muted={!videoIsMaster}
      onloadedmetadata={onVideoReady}
      onerror={onVideoError}
      onended={() => videoIsMaster && finish()}
    ></video>
  {:else if loaded.backgroundUrl || loaded.coverUrl}
    <img class="bg" src={loaded.backgroundUrl ?? loaded.coverUrl} alt="" />
  {/if}

  {#if loaded.audioUrl}
    <audio
      bind:this={audio}
      src={audioSrc}
      onloadedmetadata={onMediaReady}
      onerror={onAudioError}
      onended={finish}
    ></audio>
  {/if}

  <canvas
    bind:this={canvas}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  ></canvas>

  {#if confirmingQuit}
    <div class="overlay dim">
      <div class="dialog">
        <h2>QUIT THIS SONG?</h2>
        <p><kbd>Esc</kbd> Quit</p>
        <p><kbd>Any other key</kbd> Keep singing</p>
      </div>
    </div>
  {:else if paused}
    <div class="overlay">
      <div class="pause-box">
        <h2>{song.artist} – {song.title}</h2>
        <p>
          Space: resume &nbsp;·&nbsp; ←/→: seek &nbsp;·&nbsp; Tab: skip &nbsp;·&nbsp; +/−:
          display offset ({displayOffsetMs} ms) &nbsp;·&nbsp; F: syllable fill ({instantSyllableFill
            ? "instant"
            : "progressive"}) &nbsp;·&nbsp; Esc: quit
        </p>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="overlay"><div class="pause-box">{error}</div></div>
  {/if}

  {#if notice}
    <div class="notice">{notice}</div>
  {/if}
</div>

<style>
  .sing {
    position: fixed;
    inset: 0;
    background: #10121a;
    overflow: hidden;
  }
  video,
  .bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  /* Hide the video until its dimensions are known to avoid a brief
     small top-left flash before layout settles. */
  video {
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  video.ready {
    opacity: 1;
  }
  .bg {
    object-fit: cover;
    filter: brightness(0.55);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .pause-box {
    color: #fff;
    text-align: center;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .overlay.dim {
    background: rgba(0, 0, 0, 0.75);
  }
  .dialog {
    background: #171b29;
    border: 2px solid #37b6ff;
    border-radius: 16px;
    padding: 2.5rem 4rem;
    text-align: center;
    color: #fff;
    font-family: "Segoe UI", system-ui, sans-serif;
    box-shadow: 0 12px 60px rgba(0, 0, 0, 0.6);
  }
  .dialog h2 {
    margin: 0 0 1rem;
    font-size: 2.4rem;
    letter-spacing: 0.04em;
  }
  .dialog p {
    margin: 0.6rem 0 0;
    font-size: 1.3rem;
    color: #c8cede;
  }
  .dialog kbd {
    background: #10121a;
    border: 1px solid #2a2f45;
    border-radius: 6px;
    padding: 0.15em 0.55em;
    font-family: inherit;
    color: #37b6ff;
    font-weight: 600;
  }
  .notice {
    position: absolute;
    top: 12px;
    right: 16px;
    padding: 0.4em 0.9em;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.65);
    color: #ffcf40;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
</style>
