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
import { useCallback, useMemo } from "react";

import { boardPaths } from "../../lib/board-links";
import {
  useBoardMutationOrganizationId,
  usePublicCollections,
} from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";
import { Navbar } from "../common/navbar";
import { PoweredByTag } from "./powered-by-tag";

export function PublicBoardShell({ children }: { children: ReactNode }) {
  const site = useSite();
  const authDialogStore = useAuthDialogContext();
  const publicCollections = usePublicCollections();
  const getMutationOrganizationId = useBoardMutationOrganizationId();

  // `post-ui` receives instances, not descriptors: resolving them from this
  // document's DB client (rather than module-level singletons) is what keeps a
  // server render and a browser document from sharing collection state.
  const collections = useMemo<PostCollections>(
    () => ({
      boardCollection: publicCollections.publicBoardCollection,
      postCollection: publicCollections.publicPostCollection,
      postDetailCollection: publicCollections.publicPostDetailCollection,
      postStatusCollection: publicCollections.publicPostStatusCollection,
      upvoteCollection: publicCollections.publicUpvoteCollection,
      commentCollection: publicCollections.publicCommentCollection,
      deleteEligibilityCollection:
        publicCollections.publicDeleteEligibilityCollection,
      postReactionCollection: publicCollections.publicPostReactionCollection,
      commentReactionCollection:
        publicCollections.publicCommentReactionCollection,
      postSubscriptionCollection:
        publicCollections.publicPostSubscriptionCollection,
      //todo add member collection
    }),
    [publicCollections]
  );

  const handleAuthRequired = useCallback(() => {
    authDialogStore.send({
      type: "setOpen",
      open: true,
      data: { variant: "sign-in" },
    });
  }, [authDialogStore]);

  const getPostHref = useCallback<
    NonNullable<PostCollectionsValue["getPostHref"]>
  >((post) => boardPaths.post(post.slug), []);

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
    async (input) =>
      fetchRpc((rpc) =>
        rpc.PostCreatePublic({
          ...input,
          organizationId: getMutationOrganizationId(),
        })
      ),
    [getMutationOrganizationId]
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
