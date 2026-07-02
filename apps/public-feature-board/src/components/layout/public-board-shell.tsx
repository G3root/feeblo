import { PostCreateDialogProvider } from "@feeblo/post-ui/post-dialog-stores";
import type { ReactNode } from "react";
import { useSite } from "../../providers/site-provider";
import { AuthDialogRoot } from "../common/auth-dialog";
import { Navbar } from "../common/navbar";
import { PostCreateDialog } from "../feedback/post-create-dialog";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({ children }: { children: ReactNode }) {
  const site = useSite();

  return (
    <PostCreateDialogProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <Navbar />
        <main className="min-h-0 flex-1">{children}</main>
        <AuthDialogRoot />
        <PostCreateDialog />
        {site.hidePoweredBy ? null : <PoweredByTag />}
      </div>
    </PostCreateDialogProvider>
  );
}
