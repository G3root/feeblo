import type { TBoard } from "@feeblo/domain/board/schema";
import type { TCommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { TComment } from "@feeblo/domain/comments/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import type { TPostReaction } from "@feeblo/domain/post-reaction/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { TUpvote } from "@feeblo/domain/upvote/schema";
import type { Collection } from "@tanstack/react-db";
import { createContext, useContext } from "react";

export interface PostCollections {
  boardCollection: Collection<TBoard, string, any, any>;
  commentCollection: Collection<TComment, string, any, any>;
  commentReactionCollection: Collection<TCommentReaction, string, any, any>;
  membersCollection?: Collection<
    { id: string; organizationId: string; userId: string },
    string,
    any,
    any
  >;
  postCollection: Collection<TPost, string, any, any>;
  postReactionCollection: Collection<TPostReaction, string, any, any>;
  postStatusCollection: Collection<TPostStatus, string, any, any>;
  upvoteCollection: Collection<TUpvote, string, any, any>;
}

export interface PostCollectionsValue {
  collections: PostCollections;
  onAuthRequired?: () => void;
  organizationId: string;
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
  onAuthRequired,
  organizationId,
}: {
  children: React.ReactNode;
  collections: PostCollections;
  onAuthRequired?: () => void;
  organizationId: string;
}) {
  return (
    <PostCollectionsContext.Provider
      value={{ collections, onAuthRequired, organizationId }}
    >
      {children}
    </PostCollectionsContext.Provider>
  );
}
