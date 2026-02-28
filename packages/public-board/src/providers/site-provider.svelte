<script lang="ts">
  import type { Site } from "@feeblo/domain/site/schema";
  import { setSiteContext } from "./site-provider";

  interface Props {
    children?: import("svelte").Snippet;
    site: Site;
  }

  let { children, site }: Props = $props();

  setSiteContext(site);
</script>

{@render children?.()}
