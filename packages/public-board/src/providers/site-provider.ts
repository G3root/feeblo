import type { Site } from "@feeblo/domain/site/schema";
import { getContext, setContext } from "svelte";

const SITE_CONTEXT_KEY = Symbol("public-board.site");

export function setSiteContext(site: Site) {
  setContext(SITE_CONTEXT_KEY, site);
}

export function useSite() {
  const site = getContext<Site | undefined>(SITE_CONTEXT_KEY);
  if (!site) {
    throw new Error("Site not found");
  }

  return site;
}
