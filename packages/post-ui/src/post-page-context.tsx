import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPostListItem } from "@feeblo/domain/post/schema";
import { createContext, type ReactNode, use } from "react";

import type { BanAuthorTarget } from "./dialog-stores/ban-author";

/**
 * How the host records and lifts a ban.
 *
 * The dashboard supplies this so both writes go through its ban atoms. Those
 * bump the reactivity key the settings list is cached under, which is what
 * keeps that list and the author badges agreeing — a bare RPC would update
 * one surface and leave the other stale. A surface with no ban action (the
 * public board) omits it.
 */
export type UserBanActions = {
  readonly ban: (input: {
    readonly deleteContent: boolean;
    readonly reason?: string;
    readonly target: BanAuthorTarget;
  }) => Promise<{
    readonly deletedComments: number;
    readonly deletedPosts: number;
  }>;
  readonly unban: (input: {
    readonly target: BanAuthorTarget;
  }) => Promise<void>;
};

type TPageType = "Dashboard" | "PublicPage";

export interface PostCollectionState {
  board: TBoard;
  /**
   * Whether the host offers a ban action for comment and post authors.
   *
   * Supplied by the dashboard from the `userBans.manage` permission and the
   * plan's `userBans` capability; the public surfaces never pass it, so the
   * action does not exist there. It also requires {@link UserBanActions}: a
   * permission to offer the action without a way to perform it would render a
   * menu item that cannot do anything.
   */
  canBanAuthors: boolean;
  /**
   * Whether the host offers the lift action for a banned author.
   *
   * Separate from {@link canBanAuthors} because the two cost different things.
   * Banning needs the `userBans` plan capability; lifting one does not, so a
   * workspace that downgrades can still clear the bans it kept. Both need
   * `userBans.manage`, which the server enforces.
   */
  canUnbanAuthors: boolean;
  /** The host's ban and unban writes; see {@link UserBanActions}. */
  userBanActions: UserBanActions | undefined;
  canDeletePost: boolean;
  canManagePost: boolean;
  canModeratePost: boolean;
  isArchived: boolean;
  isAuthenticated: boolean;
  isLocked: boolean;
  isMember: boolean;
  isMerged: boolean;
  isPrivateBoard: boolean;
  isPublicBoard: boolean;
  organizationId: string;
  pageType: TPageType;
  /**
   * List-or-detail row. List surfaces pass the slim `PostListItem`;
   * detail routes merge the body over it, but `content` must be read
   * through the detail collection (see `PostPage.Content`), never from
   * this row.
   */
  post: TPostListItem;
}

export interface PostCollectionDataProviderProps {
  board: TBoard;
  canBanAuthors?: boolean;
  canUnbanAuthors?: boolean;
  children?: ReactNode;
  organizationId: string;
  pageType: TPageType;
  post: TPostListItem;
  /** See {@link PostCollectionState.userBanActions}. */
  userBanActions?: UserBanActions;
}

const PostCollectionDataContext = createContext<PostCollectionState | null>(
  null
);

export function usePostCollectionData() {
  const value = use(PostCollectionDataContext);
  if (!value) {
    throw new Error(
      "usePostCollectionData must be used within PostCollectionDataProvider"
    );
  }
  return value;
}

export function PostCollectionStateProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value: PostCollectionState;
}) {
  return (
    <PostCollectionDataContext value={value}>
      {children}
    </PostCollectionDataContext>
  );
}

export function createPostCollectionState({
  board,
  canBanAuthors = false,
  canUnbanAuthors = false,
  canDeletePost,
  canManagePost,
  canModeratePost,
  isAuthenticated,
  isMember,
  organizationId,
  pageType,
  post,
  userBanActions,
}: PostCollectionDataProviderProps &
  Pick<
    PostCollectionState,
    | "canDeletePost"
    | "canManagePost"
    | "canModeratePost"
    | "isAuthenticated"
    | "isMember"
  >): PostCollectionState {
  return {
    board,
    canBanAuthors: canBanAuthors && userBanActions !== undefined,
    canUnbanAuthors: canUnbanAuthors && userBanActions !== undefined,
    canDeletePost,
    canManagePost,
    canModeratePost,
    isArchived: post.archivedAt != null,
    isAuthenticated,
    isLocked: post.lockedAt != null,
    isMember,
    isMerged: post.mergedIntoPostId != null,
    isPrivateBoard: board.visibility === "PRIVATE",
    isPublicBoard: board.visibility === "PUBLIC",
    organizationId,
    pageType,
    post,
    userBanActions,
  };
}
