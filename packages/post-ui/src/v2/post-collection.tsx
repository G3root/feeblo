import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasPermission,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import {
  createPostCollectionState as buildPostCollectionState,
  type PostCollectionDataProviderProps,
  PostCollectionStateProvider as StateProvider,
} from "./post-page-context";

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
    allPolicy(
      hasMembership(organizationId),
      isUser(post?.creatorId ?? "")
    )
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
  const canDeletePost =
    canManageAllPosts || (isPostCreator && post?.canDeleteAsCreator === true);

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
