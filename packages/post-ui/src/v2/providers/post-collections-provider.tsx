import type { TBoard } from "@feeblo/domain/board/schema";
import type { TCommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { TComment } from "@feeblo/domain/comments/schema";
import type { TOrganizationMember } from "@feeblo/domain/membership/schema";
import type { TPostReaction } from "@feeblo/domain/post-reaction/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { TPostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import type { TPostListItem } from "@feeblo/domain/post/schema";
import type { TUpvote } from "@feeblo/domain/upvote/schema";
import type { Collection } from "@tanstack/react-db";
import { createContext, useContext, useMemo } from "react";

export interface PostCollections {
  boardCollection: Collection<TBoard, string, any, any>;
  commentCollection: Collection<TComment, string, any, any>;
  commentReactionCollection: Collection<TCommentReaction, string, any, any>;
  membersCollection?: Collection<TOrganizationMember, string, any, any>;
  /**
   * Slim list rows (`PostListItem`, no `content`). Detail bodies resolve
   * through {@link PostCollections.postDetailCollection}.
   */
  postCollection: Collection<TPostListItem, string, any, any>;
  /**
   * Full posts (`Post`, including `content`) keyed by detail slug.
   * Content edits apply here; every other mutation stays on the list
   * collection.
   */
  postDetailCollection: Collection<TPost, string, any, any>;
  postReactionCollection: Collection<TPostReaction, string, any, any>;
  postStatusCollection: Collection<TPostStatus, string, any, any>;
  postSubscriptionCollection: Collection<TPostSubscription, string, any, any>;
  upvoteCollection: Collection<TUpvote, string, any, any>;
}

/**
 * Input the shared create form passes to the surface's `persistPost`:
 * the slim list row's key fields plus the full body the list row omits.
 */
export interface PersistPostInput {
  readonly assetIds: Array<string>;
  readonly boardId: string;
  readonly content: string;
  readonly id: string;
  readonly organizationId: string;
  readonly statusId: string;
  readonly title: string;
}

export interface PostCollectionsValue {
  collections: PostCollections;
  getPostHref?: (post: TPostListItem) => string;
  onAuthRequired?: () => void;
  organizationId: string;
  /**
   * Persists a new post through the surface's create RPC (dashboard
   * `PostCreate`, public board `PostCreatePublic`). The shared create form
   * calls this inside its optimistic action; the slim list row is inserted
   * into `collections.postCollection` by the action itself, so the full
   * body travels as action input rather than through the list row.
   */
  persistPost: (input: PersistPostInput) => Promise<void>;
  suggestPosts?: (input: {
    boardId?: string;
    content: string;
    signal: AbortSignal;
    title: string;
  }) => Promise<readonly TPost[]>;
}

const PostCollectionsContext = createContext<PostCollectionsValue | null>(null);

export function usePostCollections() {
  const ctx = useContext(PostCollectionsContext);
  if (!ctx) {
    throw new Error(
      "usePostCollections must be used within PostCollectionsProvider"
    );
  }
  return ctx;
}

export function PostCollectionsProvider({
  children,
  collections,
  getPostHref,
  onAuthRequired,
  organizationId,
  persistPost,
  suggestPosts,
}: {
  children: React.ReactNode;
  collections: PostCollections;
  getPostHref?: (post: TPostListItem) => string;
  onAuthRequired?: () => void;
  organizationId: string;
  persistPost: PostCollectionsValue["persistPost"];
  suggestPosts?: PostCollectionsValue["suggestPosts"];
}) {
  const contextValue = useMemo<PostCollectionsValue>(
    () => ({
      collections,
      getPostHref,
      onAuthRequired,
      organizationId,
      persistPost,
      suggestPosts,
    }),
    [
      collections,
      getPostHref,
      onAuthRequired,
      organizationId,
      persistPost,
      suggestPosts,
    ]
  );

  return (
    <PostCollectionsContext.Provider value={contextValue}>
      {children}
    </PostCollectionsContext.Provider>
  );
}
