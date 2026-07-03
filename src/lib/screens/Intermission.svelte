<script lang="ts">
  import { formatEta, queueEtas, type QueueItem } from "../queue/queue";

  let { queue }: { queue: QueueItem[] } = $props();

  const etas = $derived(queueEtas(queue, 0));
</script>

<div class="intermission">
  <h1>UP NEXT</h1>
  <ol>
    {#each queue.slice(0, 8) as item, i (item.uid)}
      <li class:first={i === 0}>
        <span class="pos">{i + 1}</span>
        <span class="text">
          <span class="title">{item.song.title}</span>
          <span class="artist">{item.singer || item.song.artist}</span>
        </span>
        {#if i > 0}<span class="eta">{formatEta(etas[i])}</span>{/if}
      </li>
    {/each}
  </ol>
  {#if queue.length > 8}
    <p class="more">…and {queue.length - 8} more</p>
  {/if}
</div>

<style>
  .intermission {
    position: fixed;
    inset: 0;
    background: #10121a;
    color: #eee;
    font-family: "Segoe UI", "Yu Gothic UI", system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.2rem;
  }
  h1 {
    margin: 0;
    font-size: 2.2rem;
    letter-spacing: 0.12em;
    color: #37b6ff;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: min(640px, 80vw);
  }
  li {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: #1a1e2e;
    border: 1px solid #2a2f45;
    border-radius: 12px;
    padding: 0.8rem 1.2rem;
    font-size: 1.25rem;
  }
  li.first {
    border-color: #37b6ff;
    background: #101d2a;
  }
  .pos {
    color: #37b6ff;
    font-weight: 700;
    width: 1.6em;
    flex: none;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: #9aa3b8;
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .eta {
    flex: none;
    font-weight: 700;
    color: #ffcf40;
    font-variant-numeric: tabular-nums;
  }
  .more {
    color: #9aa3b8;
    margin: 0;
  }
</style>
