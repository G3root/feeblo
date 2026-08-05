import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  anyPolicy,
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
  const { allowed: canModeratePost } = usePolicy(
    hasPermission(organizationId, "posts.moderate")
  );
  // Backend mirror: PostPolicy.canUpdate/canDelete = hasMembership AND
  // (posts.manage OR post creator). Posts.moderate (lock/archive/merge) is
  // owner/admin only and intentionally NOT granted to authors.
  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasPermission(organizationId, "posts.manage"),
      isUser(post?.creatorId ?? "")
    )
  );

  const isMember =
    session?.memberships?.some((m) => m.organizationId === organizationId) ??
    false;

  const state = buildPostCollectionState({
    board,
    post,
    canManagePost,
    canModeratePost,
    organizationId,
    isMember,
    isAuthenticated: Boolean(session?.session),
    pageType,
  });

  return <StateProvider value={state}>{children}</StateProvider>;
}
