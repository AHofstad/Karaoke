<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import Sing from "$lib/screens/Sing.svelte";
  import { loadSong, type LoadedSong } from "$lib/playback/media";

  let loaded: LoadedSong | null = $state(null);
  let error = $state("");

  async function pickSong() {
    error = "";
    const path = await open({
      title: "Pick an UltraStar song txt",
      filters: [{ name: "UltraStar chart", extensions: ["txt"] }],
    });
    if (typeof path !== "string") return;
    try {
      loaded = await loadSong(path);
    } catch (e) {
      error = String(e);
    }
  }
</script>

{#if loaded}
  <Sing {loaded} onExit={() => (loaded = null)} />
{:else}
  <main>
    <h1>Karaoke</h1>
    <button onclick={pickSong}>Open song…</button>
    {#if error}<p class="error">{error}</p>{/if}
  </main>
{/if}

<style>
  main {
    height: 100vh;
    display: grid;
    place-content: center;
    gap: 1rem;
    text-align: center;
    background: #10121a;
    color: #eee;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  button {
    font-size: 1.2rem;
    padding: 0.6em 1.6em;
    border-radius: 8px;
    border: none;
    background: #37b6ff;
    color: #062033;
    cursor: pointer;
  }
  button:hover {
    background: #5cc5ff;
  }
  .error {
    color: #ff7a7a;
    max-width: 60ch;
  }
</style>
