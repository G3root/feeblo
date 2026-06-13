import type { TSite } from "@feeblo/domain/site/schema";
import { createContext, type ReactNode, useContext } from "react";

const SiteContext = createContext<TSite | null>(null);

export function SiteProvider({
  children,
  site,
}: {
  children: ReactNode;
  site: TSite;
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
