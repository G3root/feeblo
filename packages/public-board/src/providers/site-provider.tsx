import type { Site } from "@feeblo/domain/site/schema";
import { createContext, type JSX, useContext } from "solid-js";

export const SiteContext = createContext<Site | null>(null);

export function SiteProvider(props: { children: JSX.Element; site: Site }) {
  return (
    <SiteContext.Provider value={props.site}>
      {props.children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const site = useContext(SiteContext);
  if (!site) {
    throw new Error("Site not found");
  }
  return site;
}
