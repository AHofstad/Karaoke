<script lang="ts">
  import type { LibraryEntry } from "../library/scanner";
  import { filterEntries } from "../library/scanner";

  let {
    entries,
    onPick,
    onChangeFolder,
    scanning,
  }: {
    entries: LibraryEntry[];
    onPick: (entry: LibraryEntry) => void;
    onChangeFolder: () => void;
    scanning: boolean;
  } = $props();

  let query = $state("");
  const filtered = $derived(filterEntries(entries, query));
</script>

<main>
  <header>
    <h1>Karaoke</h1>
    <input type="search" placeholder="Search artist or title…" bind:value={query} />
    <button class="folder" onclick={onChangeFolder}>Change song folder…</button>
  </header>

  {#if scanning}
    <p class="status">Scanning library…</p>
  {:else if entries.length === 0}
    <p class="status">No songs found. Pick your song folder.</p>
  {:else if filtered.length === 0}
    <p class="status">No match for “{query}”.</p>
  {/if}

  <div class="grid">
    {#each filtered as entry (entry.txtPath)}
      <button class="card" onclick={() => onPick(entry)}>
        <div class="cover">
          {#if entry.coverUrl}
            <img src={entry.coverUrl} alt="" loading="lazy" />
          {:else}
            <div class="placeholder">♪</div>
          {/if}
          <div class="badges">
            {#if entry.isDuet}<span class="badge duet">DUET</span>{/if}
            {#if entry.hasVideo}<span class="badge video">VIDEO</span>{/if}
          </div>
        </div>
        <div class="meta">
          <div class="title">{entry.title}</div>
          <div class="artist">{entry.artist}</div>
        </div>
      </button>
    {/each}
  </div>
</main>

<style>
  main {
    min-height: 100vh;
    background: #10121a;
    color: #eee;
    font-family: "Segoe UI", "Yu Gothic UI", system-ui, sans-serif;
    padding: 1rem 1.5rem 2rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    position: sticky;
    top: 0;
    background: #10121a;
    padding: 0.5rem 0;
    z-index: 1;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
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
  .folder {
    margin-left: auto;
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
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1rem;
  }
  .card {
    background: #1a1e2e;
    border: 1px solid #2a2f45;
    border-radius: 10px;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    color: inherit;
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
  .meta {
    padding: 0.55rem 0.7rem 0.7rem;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: #9aa3b8;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
