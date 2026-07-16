import { AuthDialogRoot } from "@feeblo/post-ui/auth-dialog";
import {
  PostCreateDialogProvider,
  useAuthDialogContext,
} from "@feeblo/post-ui/dialog-stores";
import type { PostCollections } from "@feeblo/post-ui/post-collections-provider";
import { PostCollectionsProvider } from "@feeblo/post-ui/post-collections-provider";
import { PostCreateDialog } from "@feeblo/post-ui/post-create-dialog";
import type { ReactNode } from "react";
import { useCallback } from "react";
import {
  publicBoardCollection,
  publicCommentCollection,
  publicCommentReactionCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicUpvoteCollection,
} from "../../lib/collections";
import { useSite } from "../../providers/site-provider";
import { Navbar } from "../common/navbar";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({ children }: { children: ReactNode }) {
  const site = useSite();
  const authDialogStore = useAuthDialogContext();

  const handleAuthRequired = useCallback(() => {
    authDialogStore.send({
      type: "setOpen",
      open: true,
      data: { variant: "sign-in" },
    });
  }, [authDialogStore]);

  const collections: PostCollections = {
    boardCollection: publicBoardCollection,
    postCollection: publicPostCollection,
    postStatusCollection: publicPostStatusCollection,
    upvoteCollection: publicUpvoteCollection,
    commentCollection: publicCommentCollection,
    postReactionCollection: publicPostReactionCollection,
    commentReactionCollection: publicCommentReactionCollection,
    //todo add member collection
  };

  return (
    <PostCollectionsProvider
      collections={collections}
      onAuthRequired={handleAuthRequired}
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
