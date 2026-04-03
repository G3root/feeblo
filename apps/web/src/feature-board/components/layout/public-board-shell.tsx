import type { ReactNode } from "react";
import { useSite } from "../../providers/site-provider";
import { Navbar } from "../common/navbar";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({
  children,
}: {
  children: ReactNode;
}) {
  const site = useSite();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>{children}</main>
      {site.hidePoweredBy ? null : <PoweredByTag />}
    </div>
  );
}
