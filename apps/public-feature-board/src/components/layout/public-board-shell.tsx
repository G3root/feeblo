import { AuthDialogRoot } from "@feeblo/post-ui/auth-dialog";
import {
  PostCreateDialogProvider,
  useAuthDialogContext,
} from "@feeblo/post-ui/dialog-stores";
import type { PostCollections } from "@feeblo/post-ui/post-collections-provider";
import {
  PostCollectionsProvider,
  type PostCollectionsValue,
} from "@feeblo/post-ui/post-collections-provider";
import { PostCreateDialog } from "@feeblo/post-ui/post-create-dialog";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import type { ReactNode } from "react";
import { useCallback } from "react";

import {
  publicBoardCollection,
  publicCommentCollection,
  publicCommentReactionCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostSubscriptionCollection,
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

  const getPostHref = useCallback<
    NonNullable<PostCollectionsValue["getPostHref"]>
  >((post) => `/p/${post.slug}`, []);

  const suggestPosts = useCallback<
    NonNullable<PostCollectionsValue["suggestPosts"]>
  >(
    ({ signal, ...input }) =>
      fetchRpc(
        (rpc) =>
          rpc.PostSuggestionsPublic({
            ...input,
            limit: 5,
            organizationId: site.organizationId,
          }),
        { signal }
      ),
    [site.organizationId]
  );

  const collections: PostCollections = {
    boardCollection: publicBoardCollection,
    postCollection: publicPostCollection,
    postStatusCollection: publicPostStatusCollection,
    upvoteCollection: publicUpvoteCollection,
    commentCollection: publicCommentCollection,
    postReactionCollection: publicPostReactionCollection,
    commentReactionCollection: publicCommentReactionCollection,
    postSubscriptionCollection: publicPostSubscriptionCollection,
    //todo add member collection
  };

  return (
    <PostCollectionsProvider
      collections={collections}
      getPostHref={getPostHref}
      onAuthRequired={handleAuthRequired}
      organizationId={site.organizationId}
      suggestPosts={suggestPosts}
    >
      <PostCreateDialogProvider>
        <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
          <AuthDialogRoot />
          <PostCreateDialog />
          {site.hidePoweredBy ? null : <PoweredByTag />}
        </div>
      </PostCreateDialogProvider>
    </PostCollectionsProvider>
  );
}
