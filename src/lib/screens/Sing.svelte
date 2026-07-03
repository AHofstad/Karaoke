<script lang="ts">
  import { onMount } from "svelte";
  import type { LoadedSong } from "../playback/media";
  import { songEndMs, timePhrases } from "../playback/clock";
  import { DUET_P2_COLORS, LyricsLane, SOLO_COLORS } from "../render/lyricsRenderer";

  let { loaded, onExit }: { loaded: LoadedSong; onExit: () => void } = $props();

  let canvas: HTMLCanvasElement;
  let audio: HTMLAudioElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let paused = $state(false);
  let error = $state("");
  let videoFailed = $state(false);

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

    const t = nowMs();

    // Slave the muted video to the audio clock (M3 refines with VIDEOGAP).
    if (!videoIsMaster && video && audio && !videoFailed) {
      const target = audio.currentTime + timing.videoGapSec;
      if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      if (audio.paused !== video.paused) {
        if (audio.paused) video.pause();
        else void video.play().catch(() => {});
      }
    }

    const baseFontSize = Math.max(24, Math.round(h / 14));
    if (lanes.length > 1) {
      lanes[0].render(ctx, t, w, {
        centerY: h * 0.82,
        colors: SOLO_COLORS,
        name: song.voices[0].name ?? "P1",
        baseFontSize,
      });
      lanes[1].render(ctx, t, w, {
        centerY: h * 0.14,
        colors: DUET_P2_COLORS,
        name: song.voices[1].name ?? "P2",
        baseFontSize,
      });
    } else if (lanes.length === 1) {
      lanes[0].render(ctx, t, w, {
        centerY: h * 0.82,
        colors: SOLO_COLORS,
        baseFontSize,
      });
    }

    if (endMs !== undefined && t >= endMs) finish();
  }

  function finish() {
    cancelAnimationFrame(raf);
    onExit();
  }

  function togglePause() {
    const m = master();
    if (!m) return;
    if (m.paused) {
      void m.play();
      paused = false;
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
      case "Escape":
        finish();
        break;
    }
  }

  function onMediaReady() {
    const m = master();
    if (!m) return;
    if (timing.startSec) m.currentTime = timing.startSec;
    void m.play().catch((e) => {
      error = `Could not start playback: ${e}`;
    });
  }

  function onVideoError() {
    videoFailed = true;
  }

  onMount(() => {
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="sing">
  {#if loaded.videoUrl && !videoFailed}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      src={loaded.videoUrl}
      muted={!videoIsMaster}
      onloadedmetadata={() => videoIsMaster && onMediaReady()}
      onerror={onVideoError}
      onended={() => videoIsMaster && finish()}
    ></video>
  {:else if loaded.backgroundUrl || loaded.coverUrl}
    <img class="bg" src={loaded.backgroundUrl ?? loaded.coverUrl} alt="" />
  {/if}

  {#if loaded.audioUrl}
    <audio
      bind:this={audio}
      src={loaded.audioUrl}
      onloadedmetadata={onMediaReady}
      onended={finish}
    ></audio>
  {/if}

  <canvas bind:this={canvas}></canvas>

  {#if paused}
    <div class="overlay">
      <div class="pause-box">
        <h2>{song.artist} – {song.title}</h2>
        <p>Space: resume &nbsp;·&nbsp; ←/→: seek &nbsp;·&nbsp; Esc: quit</p>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="overlay"><div class="pause-box">{error}</div></div>
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
</style>
