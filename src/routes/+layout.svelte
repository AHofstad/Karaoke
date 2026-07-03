<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #10121a;
    overflow: hidden;
  }
  :global(::-webkit-scrollbar) {
    width: 10px;
  }
  :global(::-webkit-scrollbar-track) {
    background: #10121a;
  }
  :global(::-webkit-scrollbar-thumb) {
    background: #2a2f45;
    border-radius: 5px;
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: #3a4160;
  }
</style>
