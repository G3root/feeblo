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

/**
 * Everything the state provider needs once the viewer's affordances are known.
 *
 * Split out so the contributor-only eligibility read can live in its own
 * component (see `ContributorEligibilityProvider`): the read must not exist for
 * anyone it cannot run for.
 */
type ResolvedProviderProps = PostCollectionDataProviderProps & {
  canDeletePost: boolean;
  canManageAllPosts: boolean;
  canManagePost: boolean;
  isMember: boolean;
  isSessionAuthenticated: boolean;
};

function ResolvedPostCollectionProvider({
  board,
  canDeletePost,
  canManageAllPosts,
  canManagePost,
  children,
  isMember,
  isSessionAuthenticated,
  organizationId,
  pageType,
  post,
}: ResolvedProviderProps) {
  const state = buildPostCollectionState({
    board,
    canDeletePost,
    post,
    canManagePost,
    canModeratePost: canManageAllPosts,
    organizationId,
    isMember,
    isAuthenticated: isSessionAuthenticated,
    pageType,
  });

  return <StateProvider value={state}>{children}</StateProvider>;
}

/**
 * The delete hint for a non-privileged creator viewing their own post.
 *
 * This is its own component because a live query must not exist when it cannot
 * run. `useLiveQuery` returns `undefined` to disable a query, but a disabled
 * query still carries an identity, and TanStack DB 1.0 makes the browser wait
 * for a server-rendered snapshot of every identity that was not dehydrated.
 * For a signed-out visitor — who can never be the post's creator — that wait is
 * unsatisfiable, and it fails the whole hydration pass with error 253 when the
 * DB stream closes. Not mounting the query at all is the only way to opt out.
 */
function ContributorEligibilityProvider({
  deleteEligibilityCollection,
  organizationId,
  post,
  ...resolved
}: Omit<ResolvedProviderProps, "canDeletePost"> & {
  deleteEligibilityCollection: NonNullable<
    ReturnType<
      typeof usePostCollections
    >["collections"]["deleteEligibilityCollection"]
  >;
}) {
  const eligibilityQuery = useLiveQuery({
    // Reached once per post card, and the card re-renders with the whole list,
    // so the explicit key keeps identity work off that path.
    queryKey: [
      "post-delete-eligibility",
      deleteEligibilityCollection.id,
      organizationId,
      post.id,
    ],
    query: (q) =>
      q
        .from({ eligibility: deleteEligibilityCollection })
        .where(({ eligibility }) =>
          and(
            eq(eligibility.organizationId, organizationId),
            eq(eligibility.postId, post.id)
          )
        )
        .select(({ eligibility }) => ({ postId: eligibility.postId }))
        .findOne(),
  });

  return (
    <ResolvedPostCollectionProvider
      {...resolved}
      canDeletePost={eligibilityQuery.data != null}
      organizationId={organizationId}
      post={post}
    />
  );
}

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
  // the injected eligibility collection for the viewed post instead. Card
  // lists therefore never fetch per-card eligibility.
  const {
    collections: { deleteEligibilityCollection },
  } = usePostCollections();
  const contributorCase = isPostCreator && !canManageAllPosts;

  const resolved = {
    board,
    canManageAllPosts,
    canManagePost,
    children,
    isMember:
      session?.memberships?.some(
        (membership) => membership.organizationId === organizationId
      ) ?? false,
    isSessionAuthenticated: Boolean(session?.session),
    organizationId,
    pageType,
    post,
  };

  // A post id is always present here; the guard documents what the branch
  // depends on so a future prop change cannot silently start subscribing to
  // eligibility for someone who cannot delete.
  if (contributorCase && post?.id && deleteEligibilityCollection) {
    return (
      <ContributorEligibilityProvider
        {...resolved}
        deleteEligibilityCollection={deleteEligibilityCollection}
      />
    );
  }

  return (
    <ResolvedPostCollectionProvider
      {...resolved}
      canDeletePost={canManageAllPosts}
    />
  );
}
