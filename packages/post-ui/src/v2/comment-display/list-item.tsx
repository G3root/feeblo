import type { TComment } from "@feeblo/domain/src/comments/schema.js";

import { usePostCollections } from "../providers/post-collections-provider";
import { CommentDisplayComponent } from "./component";

interface CommentDisplayItemProps {
  currentUserId?: string;
  data: TComment;
}

export function CommentDisplayItem({
  data,
  currentUserId,
}: CommentDisplayItemProps) {
  const {
    collections: { commentCollection },
  } = usePostCollections();

  return (
    <CommentDisplayComponent
      authorName={data.user.name}
      commentId={data.id}
      content={data.content}
      createdAt={data.createdAt}
      isAuthor={currentUserId ? data.userId === currentUserId : false}
      isInternal={data.visibility === "INTERNAL"}
      onDelete={() => {}}
      onReply={() => {}}
      onUpdate={async ({ content, isPrivate }) => {
        const tx = commentCollection.update(data.id, (draft) => {
          draft.content = content;
          draft.visibility = isPrivate ? "INTERNAL" : "PUBLIC";
        });
        await tx.isPersisted.promise;
      }}
      postId={data.postId}
      postSlug={data.postSlug}
    />
  );
}
