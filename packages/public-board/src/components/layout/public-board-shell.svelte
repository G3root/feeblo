<script lang="ts">
  import Navbar from "../common/navbar.svelte";

  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();
</script>

<div>
  <Navbar />
  {@render children?.()}
</div>
