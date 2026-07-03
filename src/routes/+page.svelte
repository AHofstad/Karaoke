<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import Sing from "$lib/screens/Sing.svelte";
  import SongList from "$lib/screens/SongList.svelte";
  import { scanLibrary, type LibraryEntry } from "$lib/library/scanner";
  import { loadSong, type LoadedSong } from "$lib/playback/media";

  const ROOT_KEY = "karaoke.songRoot";

  let entries: LibraryEntry[] = $state([]);
  let scanning = $state(false);
  let loaded: LoadedSong | null = $state(null);
  let error = $state("");

  async function rescan(rootDir: string) {
    scanning = true;
    error = "";
    try {
      entries = await scanLibrary(rootDir);
      localStorage.setItem(ROOT_KEY, rootDir);
    } catch (e) {
      error = `Scan failed: ${e}`;
    } finally {
      scanning = false;
    }
  }

  async function pickFolder() {
    const dir = await open({ title: "Pick your songs folder", directory: true });
    if (typeof dir === "string") await rescan(dir);
  }

  async function pick(entry: LibraryEntry) {
    error = "";
    try {
      loaded = await loadSong(entry.txtPath);
    } catch (e) {
      error = String(e);
    }
  }

  onMount(() => {
    const saved = localStorage.getItem(ROOT_KEY);
    if (saved) void rescan(saved);
  });
</script>

{#if loaded}
  <Sing {loaded} onExit={() => (loaded = null)} />
{:else}
  <SongList {entries} {scanning} onPick={pick} onChangeFolder={pickFolder} />
  {#if error}
    <p class="error">{error}</p>
  {/if}
{/if}

<style>
  .error {
    position: fixed;
    bottom: 0.5rem;
    left: 1.5rem;
    color: #ff7a7a;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
</style>
