<script lang="ts">
  import type { LibraryEntry } from "../library/scanner";
  import { filterEntries, scanProgress } from "../library/scanner";
  import { loudnessProgress } from "../library/loudness";
  import type { QueueItem } from "../queue/queue";
  import type { SvelteSet } from "svelte/reactivity";
  import { appDataDir } from "@tauri-apps/api/path";
  import { openPath } from "@tauri-apps/plugin-opener";

  async function openAppData() {
    await openPath(await appDataDir());
  }

  function formatDuration(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  }

  let {
    entries,
    queue,
    played,
    remoteUrl,
    qrDataUrl,
    onQueueAdd,
    onQueueRemove,
    onQueueMove,
    onQueueClear,
    onPlayNext,
    onChangeFolder,
    onRefreshLibrary,
    scanning,
  }: {
    entries: LibraryEntry[];
    queue: QueueItem[];
    played: SvelteSet<string>;
    remoteUrl: string | null;
    qrDataUrl: string;
    onQueueAdd: (entry: LibraryEntry) => void;
    onQueueRemove: (uid: number) => void;
    onQueueMove: (uid: number, newIndex: number) => void;
    onQueueClear: () => void;
    onPlayNext: () => void;
    onChangeFolder: () => void;
    onRefreshLibrary: () => void;
    scanning: boolean;
  } = $props();

  let query = $state("");
  const filtered = $derived(filterEntries(entries, query));

  // Resizable queue sidebar (drag the divider), persisted.
  const WIDTH_KEY = "karaoke.sidebarWidth";
  let sidebarWidth = $state(clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 280));
  let resizing = false;

  function clampWidth(w: number): number {
    return Math.min(600, Math.max(220, w));
  }

  function startResize(e: PointerEvent) {
    resizing = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResize(e: PointerEvent) {
    if (!resizing) return;
    sidebarWidth = clampWidth(window.innerWidth - e.clientX);
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
    localStorage.setItem(WIDTH_KEY, String(sidebarWidth));
  }
</script>

<div class="layout" style="grid-template-columns: 1fr 6px {sidebarWidth}px">
  <main>
    <header>
      <h1>Karaoke</h1>
      <input type="search" placeholder="Search artist, title, tags…" bind:value={query} />
      {#if scanning && $scanProgress.total > 0}
        <div class="normalize" title="Parsing new or changed songs">
          <span>Scanning library… {$scanProgress.done} / {$scanProgress.total}</span>
          <div class="track">
            <div class="fill" style="width: {(100 * $scanProgress.done) / $scanProgress.total}%"></div>
          </div>
        </div>
      {/if}
      {#if $loudnessProgress.total > 0 && $loudnessProgress.done < $loudnessProgress.total}
        <div class="normalize" title="Measuring song volume in the background so all songs play equally loud">
          <span>Normalizing volume… {$loudnessProgress.done} / {$loudnessProgress.total}</span>
          <div class="track">
            <div class="fill" style="width: {(100 * $loudnessProgress.done) / $loudnessProgress.total}%"></div>
          </div>
        </div>
      {/if}
      <div class="folder-buttons">
        <button class="folder" onclick={onRefreshLibrary} disabled={scanning}>Refresh library</button>
        <button class="folder" onclick={onChangeFolder}>Change song folder…</button>
        <button class="folder" onclick={openAppData}>Open app data folder…</button>
      </div>
    </header>

    <div class="scroll">
      {#if scanning}
        <p class="status">Scanning library…</p>
      {:else if entries.length === 0}
        <p class="status">No songs found. Pick your song folder.</p>
      {:else if filtered.length === 0}
        <p class="status">No match for “{query}”.</p>
      {/if}

      <div class="grid">
        {#each filtered as entry (entry.txtPath)}
        <div class="card">
          <button class="cover" onclick={() => onQueueAdd(entry)} title="Add to queue">
            {#if entry.coverUrl}
              <img src={entry.coverUrl} alt="" loading="lazy" />
            {:else}
              <div class="placeholder">♪</div>
            {/if}
            <div class="badges">
              {#if played.has(entry.txtPath)}<span class="badge played">PLAYED</span>{/if}
              {#if entry.isDuet}<span class="badge duet">DUET</span>{/if}
              {#if entry.hasVideo}<span class="badge video">VIDEO</span>{/if}
            </div>
          </button>
          <div class="meta">
            <div class="text">
              <div class="title">{entry.title}</div>
              <div class="artist">{entry.artist}</div>
              <div class="duration">{formatDuration(entry.durationMs)}</div>
            </div>
          </div>
        </div>
        {/each}
      </div>
    </div>
  </main>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="divider"
    onpointerdown={startResize}
    onpointermove={onResize}
    onpointerup={endResize}
    onpointercancel={endResize}
  ></div>

  <aside>
    {#if remoteUrl}
      <div class="remote">
        <h2>Phone remote</h2>
        {#if qrDataUrl}<img class="qr" src={qrDataUrl} alt="QR code" />{/if}
        <code>{remoteUrl}</code>
        <p class="status">Guests on the same Wi-Fi can browse and queue songs.</p>
      </div>
    {/if}

    <div class="queue-head">
      <h2>Queue</h2>
      <button class="clear" onclick={onQueueClear} disabled={queue.length === 0}>Clear</button>
    </div>
    <button class="play" onclick={onPlayNext} disabled={queue.length === 0}>▶ Play queue</button>
    {#if queue.length === 0}
      <p class="status">Empty. Click a song to add it, or scan the QR with your phone.</p>
    {:else}
      <ol>
        {#each queue as item, index (item.uid)}
          <li>
            <div class="move">
              <button
                class="mv"
                title="Move up"
                disabled={index === 0}
                onclick={() => onQueueMove(item.uid, index - 1)}
              >▲</button>
              <button
                class="mv"
                title="Move down"
                disabled={index === queue.length - 1}
                onclick={() => onQueueMove(item.uid, index + 1)}
              >▼</button>
            </div>
            <div class="qtext">
              <div class="title">{item.song.title}</div>
              <div class="artist">
                {item.song.artist}{item.singer ? ` — ${item.singer}` : ""}
              </div>
            </div>
            <button class="remove" title="Remove" onclick={() => onQueueRemove(item.uid)}>×</button>
          </li>
        {/each}
      </ol>
    {/if}
  </aside>
</div>

<style>
  .layout {
    display: grid;
    height: 100vh;
    overflow: hidden;
    background: #10121a;
    color: #eee;
    font-family: "Segoe UI", "Yu Gothic UI", system-ui, sans-serif;
  }
  main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 1rem 0 0 1.5rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1.5rem 1rem 0;
    flex: none;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 1.5rem 2rem 0;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  h2 {
    margin: 0 0 0.6rem;
    font-size: 1.05rem;
  }
  input {
    flex: 1;
    max-width: 26rem;
    padding: 0.5em 0.9em;
    border-radius: 8px;
    border: 1px solid #2a2f45;
    background: #1a1e2e;
    color: #eee;
    font-size: 1rem;
  }
  input:focus {
    outline: 2px solid #37b6ff;
  }
  .folder-buttons {
    margin-left: auto;
    display: flex;
    gap: 0.6rem;
    flex: none;
  }
  .folder {
    background: none;
    border: 1px solid #2a2f45;
    color: #9aa3b8;
    border-radius: 8px;
    padding: 0.45em 0.9em;
    cursor: pointer;
  }
  .folder:hover {
    color: #eee;
    border-color: #37b6ff;
  }
  .status {
    color: #9aa3b8;
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 1rem;
  }
  .card {
    background: #1a1e2e;
    border: 1px solid #2a2f45;
    border-radius: 10px;
    overflow: hidden;
    transition: transform 0.08s ease, border-color 0.08s ease;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: #37b6ff;
  }
  .cover {
    position: relative;
    aspect-ratio: 1;
    background: #0c0e16;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    cursor: pointer;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    font-size: 3rem;
    color: #2a2f45;
  }
  .badges {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
  }
  .badge {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.7);
  }
  .badge.duet {
    color: #ff7ab0;
  }
  .badge.video {
    color: #37b6ff;
  }
  .badge.played {
    color: #7fce7f;
  }
  .normalize {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 12rem;
    color: #9aa3b8;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .track {
    height: 4px;
    border-radius: 2px;
    background: #2a2f45;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: #37b6ff;
    transition: width 0.3s ease;
  }
  .meta {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.55rem 0.55rem 0.7rem 0.7rem;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    word-break: break-word;
  }
  .artist {
    color: #9aa3b8;
    font-size: 0.85rem;
    word-break: break-word;
  }
  .duration {
    color: #6b7690;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .divider {
    cursor: col-resize;
    background: #2a2f45;
    touch-action: none;
  }
  .divider:hover {
    background: #37b6ff;
  }
  aside {
    padding: 1.4rem 1rem;
    background: #12151f;
    overflow-y: auto;
    min-width: 0;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0 0 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #1a1e2e;
    border: 1px solid #2a2f45;
    border-radius: 8px;
    padding: 0.45rem 0.55rem;
  }
  .move {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: none;
  }
  .mv {
    background: none;
    border: 1px solid #2a2f45;
    color: #9aa3b8;
    border-radius: 5px;
    padding: 0.05em 0.4em;
    font-size: 0.7rem;
    line-height: 1.3;
    cursor: pointer;
  }
  .mv:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .mv:not(:disabled):hover {
    color: #37b6ff;
    border-color: #37b6ff;
  }
  .qtext {
    flex: 1;
    min-width: 0;
  }
  .remove {
    flex: none;
    background: none;
    border: none;
    color: #9aa3b8;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .remove:hover {
    color: #ff7a7a;
  }
  .play {
    width: 100%;
    padding: 0.55em;
    border: none;
    border-radius: 8px;
    background: #37b6ff;
    color: #062033;
    font-weight: 700;
    cursor: pointer;
    margin-bottom: 0.8rem;
  }
  .play:disabled {
    background: #2a2f45;
    color: #9aa3b8;
    cursor: default;
  }
  .queue-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }
  .queue-head h2 {
    margin: 0;
  }
  .clear {
    background: none;
    border: 1px solid #2a2f45;
    color: #9aa3b8;
    border-radius: 8px;
    padding: 0.25em 0.7em;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .clear:hover:enabled {
    color: #ff7a7a;
    border-color: #ff7a7a;
  }
  .clear:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .remote {
    margin-bottom: 1.4rem;
    border-bottom: 1px solid #2a2f45;
    padding-bottom: 1rem;
    text-align: center;
  }
  .qr {
    display: block;
    border-radius: 8px;
    margin: 0 auto 0.5rem;
    background: #fff;
  }
  code {
    font-size: 0.8rem;
    color: #37b6ff;
    word-break: break-all;
  }
</style>
