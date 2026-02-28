<script lang="ts">
import { Router } from "sv-router";
import type { PublicBoardAppProps } from "./public-board-app";
import "./router";
import SiteProvider from "../providers/site-provider.svelte";

let { basePath = "", site }: PublicBoardAppProps = $props();
</script>

<SiteProvider {site}>
  <Router base={basePath} />
</SiteProvider>
