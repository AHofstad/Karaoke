<script lang="ts">
  import "../app.css";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let { children } = $props();

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "F11") {
      e.preventDefault();
      void toggleFullscreen();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{@render children()}
