<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import Intermission from "$lib/screens/Intermission.svelte";
  import Sing from "$lib/screens/Sing.svelte";
  import SongList from "$lib/screens/SongList.svelte";
  import { scanLibrary, type LibraryEntry } from "$lib/library/scanner";
  import { loadSong, type LoadedSong } from "$lib/playback/media";
  import {
    addToQueue,
    getQueue,
    getRemoteInfo,
    nextInQueue,
    onQueueUpdated,
    onRemoteSkip,
    publishLibrary,
    removeFromQueue,
    reportStopped,
    type QueueSnapshot,
    type RemoteInfo,
  } from "$lib/queue/queue";

  const ROOT_KEY = "karaoke.songRoot";

  let entries: LibraryEntry[] = $state([]);
  let scanning = $state(false);
  let loaded: LoadedSong | null = $state(null);
  let error = $state("");
  let queue: QueueSnapshot = $state({ nowPlaying: null, remainingMs: null, queue: [] });
  let remoteInfo: RemoteInfo | null = $state(null);
  let qrDataUrl = $state("");
  let playing = false; // mirror of `loaded` readable inside event callbacks
  let advancing = false; // guards against concurrent queue advances
  let playCounter = $state(0); // forces <Sing> remount per played song

  async function rescan(rootDir: string) {
    scanning = true;
    error = "";
    try {
      entries = await scanLibrary(rootDir);
      localStorage.setItem(ROOT_KEY, rootDir);
      await publishLibrary(entries);
      await refreshQueue();
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

  async function refreshQueue() {
    try {
      queue = await getQueue();
    } catch {
      // remote state not ready yet
    }
  }

  async function playEntry(entry: LibraryEntry) {
    error = "";
    try {
      loaded = await loadSong(entry.txtPath);
      playCounter++;
      playing = true;
    } catch (e) {
      error = String(e);
    }
  }

  async function playNext() {
    if (advancing) return;
    advancing = true;
    try {
      const next = await nextInQueue();
      if (next) {
        loaded = await loadSong(next.txtPath);
        playCounter++;
        playing = true;
      } else {
        loaded = null;
        playing = false;
      }
    } catch (e) {
      error = String(e);
      loaded = null;
      playing = false;
    } finally {
      advancing = false;
    }
  }

  let intermission = $state(false);

  async function songFinished() {
    // Natural end or skip: show the upcoming queue briefly, then continue.
    loaded = null;
    await refreshQueue();
    if (queue.queue.length > 0) {
      intermission = true;
      setTimeout(() => {
        intermission = false;
        void playNext();
      }, 3000);
    } else {
      await playNext();
    }
  }

  async function exitToList() {
    loaded = null;
    playing = false;
    await reportStopped();
  }

  async function queueAdd(entry: LibraryEntry) {
    const id = entries.indexOf(entry);
    if (id >= 0) await addToQueue(id);
  }

  onMount(() => {
    const saved = localStorage.getItem(ROOT_KEY);
    if (saved) void rescan(saved);

    void getRemoteInfo().then(async (info) => {
      remoteInfo = info;
      if (info.url) qrDataUrl = await QRCode.toDataURL(info.url, { margin: 1, width: 160 });
    });

    const unsubs: Array<() => void> = [];
    void onQueueUpdated(() => void refreshQueue()).then((u) => unsubs.push(u));
    void onRemoteSkip(() => {
      if (playing) void playNext();
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  });
</script>

{#if loaded}
  {#key playCounter}
    <Sing {loaded} onExit={exitToList} onSkip={songFinished} />
  {/key}
{:else if intermission}
  <Intermission queue={queue.queue} />
{:else}
  <SongList
    {entries}
    {scanning}
    queue={queue.queue}
    remoteUrl={remoteInfo?.url ?? null}
    {qrDataUrl}
    onPick={playEntry}
    onQueueAdd={queueAdd}
    onQueueRemove={(uid) => void removeFromQueue(uid)}
    onPlayNext={() => void playNext()}
    onChangeFolder={pickFolder}
  />
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
