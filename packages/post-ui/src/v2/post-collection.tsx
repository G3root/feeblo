import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasPermission,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import {
  createPostCollectionState as buildPostCollectionState,
  type PostCollectionDataProviderProps,
  PostCollectionStateProvider as StateProvider,
} from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

export function PostCollectionDataProvider({
  board,
  children,
  post,
  organizationId,
  pageType,
}: PostCollectionDataProviderProps) {
  const { data: session } = useAuthState();
  const { allowed: canManageAllPosts } = usePolicy(
    hasPermission(organizationId, "posts.*")
  );
  const { allowed: isPostCreator } = usePolicy(
    allPolicy(hasMembership(organizationId), isUser(post?.creatorId ?? ""))
  );
  // Backend mirror: PostPolicy.canUpdate = hasMembership AND
  // (posts.* OR post creator). PostPolicy.canDelete additionally requires
  // an untouched post for contributors. Posts.* (lock/archive/merge) is manager+
  // and intentionally NOT granted to contributors merely because
  // they authored the post.
  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasPermission(organizationId, "posts.*"),
      allPolicy(hasMembership(organizationId), isUser(post?.creatorId ?? ""))
    )
  );
  // List rows carry no delete hint; contributor affordances subscribe to
  // the injected eligibility collection for the viewed post instead. The
  // query stays undefined (no sync) unless a non-privileged creator views
  // their own post, so card lists never fetch per-card eligibility.
  const {
    collections: { deleteEligibilityCollection },
  } = usePostCollections();
  const contributorCase = isPostCreator && !canManageAllPosts;
  const eligibilityQuery = useLiveQuery(
    (q) => {
      if (!contributorCase || !deleteEligibilityCollection || !post?.id) {
        return undefined;
      }
      return q
        .from({ eligibility: deleteEligibilityCollection })
        .where(({ eligibility }) =>
          and(
            eq(eligibility.organizationId, organizationId),
            eq(eligibility.postId, post.id)
          )
        )
        .select(({ eligibility }) => ({ postId: eligibility.postId }))
        .findOne();
    },
    [contributorCase, deleteEligibilityCollection, organizationId, post?.id]
  );
  const canDeletePost =
    canManageAllPosts || (isPostCreator && eligibilityQuery.data != null);

  const isMember =
    session?.memberships?.some((m) => m.organizationId === organizationId) ??
    false;

  const state = buildPostCollectionState({
    board,
    canDeletePost,
    post,
    canManagePost,
    canModeratePost: canManageAllPosts,
    organizationId,
    isMember,
    isAuthenticated: Boolean(session?.session),
    pageType,
  });

  return <StateProvider value={state}>{children}</StateProvider>;
}
