import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
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
  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(organizationId),
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
    organizationId,
    isMember,
    isAuthenticated: Boolean(session?.session),
    pageType,
  });

  return <StateProvider value={state}>{children}</StateProvider>;
}
