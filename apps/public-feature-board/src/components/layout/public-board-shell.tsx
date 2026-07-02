import type { PostCollections } from "@feeblo/post-ui/post-collections-provider";
import { PostCollectionsProvider } from "@feeblo/post-ui/post-collections-provider";
import { PostCreateDialog } from "@feeblo/post-ui/post-create-dialog";
import { PostCreateDialogProvider } from "@feeblo/post-ui/post-dialog-stores";
import type { ReactNode } from "react";
import {
  publicBoardCollection,
  publicCommentCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicUpvoteCollection,
} from "../../lib/collections";
import { useSite } from "../../providers/site-provider";
import { AuthDialogRoot } from "../common/auth-dialog";
import { Navbar } from "../common/navbar";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({ children }: { children: ReactNode }) {
  const site = useSite();

  const collections: PostCollections = {
    boardCollection: publicBoardCollection,
    postCollection: publicPostCollection,
    postStatusCollection: publicPostStatusCollection,
    upvoteCollection: publicUpvoteCollection,
    commentCollection: publicCommentCollection,
    postReactionCollection: publicPostReactionCollection,
    //todo add member collection
  };

  return (
    <PostCollectionsProvider
      collections={collections}
      organizationId={site.organizationId}
    >
      <PostCreateDialogProvider>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <Navbar />
          <main className="min-h-0 flex-1">{children}</main>
          <AuthDialogRoot />
          <PostCreateDialog />
          {site.hidePoweredBy ? null : <PoweredByTag />}
        </div>
      </PostCreateDialogProvider>
    </PostCollectionsProvider>
  );
}
