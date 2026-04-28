import type { ReactNode } from "react";
import { useSite } from "../../providers/site-provider";
import { AuthDialogRoot } from "../common/auth-dialog";
import { Navbar } from "../common/navbar";
import { PostCreateDialog } from "../feedback/post-create-dialog";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({ children }: { children: ReactNode }) {
  const site = useSite();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>{children}</main>
      <AuthDialogRoot />
      <PostCreateDialog />
      {site.hidePoweredBy ? null : <PoweredByTag />}
    </div>
  );
}
