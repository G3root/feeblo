import type { Site } from "@feeblo/domain/site/schema";
import { createContext, type ReactNode, useContext } from "react";

const SiteContext = createContext<Site | null>(null);

export function SiteProvider({
  children,
  site,
}: {
  children: ReactNode;
  site: Site;
}) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const site = useContext(SiteContext);

  if (!site) {
    throw new Error("Site not found");
  }

  return site;
}
