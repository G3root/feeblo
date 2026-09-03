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
  publicPostDetailCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostSubscriptionCollection,
  publicUpvoteCollection,
  getMutationOrganizationId,
} from "../../lib/collections";
import { useSite } from "../../providers/site-provider";
import { Navbar } from "../common/navbar";
import { PoweredByTag } from "./powered-by-tag";

const collections: PostCollections = {
  boardCollection: publicBoardCollection,
  postCollection: publicPostCollection,
  postDetailCollection: publicPostDetailCollection,
  postStatusCollection: publicPostStatusCollection,
  upvoteCollection: publicUpvoteCollection,
  commentCollection: publicCommentCollection,
  postReactionCollection: publicPostReactionCollection,
  commentReactionCollection: publicCommentReactionCollection,
  postSubscriptionCollection: publicPostSubscriptionCollection,
  //todo add member collection
};

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

  // The shared create form persists through this surface RPC (public
  // visibility rules, restricted-session scoping) inside its optimistic
  // action; the list row itself carries no body.
  const persistPost = useCallback<PostCollectionsValue["persistPost"]>(
    async (input) => {
      await fetchRpc((rpc) =>
        rpc.PostCreatePublic({
          ...input,
          organizationId: getMutationOrganizationId(),
        })
      );
    },
    []
  );

  return (
    <PostCollectionsProvider
      collections={collections}
      getPostHref={getPostHref}
      onAuthRequired={handleAuthRequired}
      organizationId={site.organizationId}
      persistPost={persistPost}
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
