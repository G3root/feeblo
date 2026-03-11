import type { Comment } from "@feeblo/domain/comments/schema";
import { useState } from "react";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { formatDate, getInitials } from "../../lib/utils";
import { CommentComposer } from "./comment-composer";

export function CommentThread({
  canReply,
  comment,
  currentUserName,
  onSubmitReply,
  repliesByParentId,
}: {
  canReply: boolean;
  comment: Comment;
  currentUserName: string | null;
  onSubmitReply: (content: string, parentCommentId: string) => Promise<void>;
  repliesByParentId: ReadonlyMap<string, Comment[]>;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const replies = repliesByParentId.get(comment.id) ?? [];

  return (
    <div className="space-y-3">
      <Item
        className="items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-4"
        variant="outline"
      >
        <ItemMedia>
          <Avatar>
            <AvatarFallback>{getInitials(comment.user.name)}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="gap-3">
          <ItemHeader className="items-start">
            <div className="space-y-1">
              <ItemTitle>{comment.user.name}</ItemTitle>
              <p className="text-muted-foreground text-xs">
                {formatDate(comment.createdAt)}
              </p>
            </div>
            {canReply ? (
              <Button
                onClick={() => {
                  setIsReplying((current) => !current);
                }}
                size="sm"
                type="button"
                variant={isReplying ? "default" : "ghost"}
              >
                {isReplying ? "Cancel" : "Reply"}
              </Button>
            ) : null}
          </ItemHeader>
          <ItemDescription className="line-clamp-none whitespace-pre-wrap text-foreground">
            {comment.content}
          </ItemDescription>
        </ItemContent>
      </Item>

      {isReplying && currentUserName ? (
        <div className="pl-0 sm:pl-11">
          <CommentComposer
            autoFocus
            onSubmit={async (content) => {
              await onSubmitReply(content, comment.id);
              setIsReplying(false);
            }}
            placeholder="Write a reply..."
            submitLabel="Reply"
            userName={currentUserName}
          />
        </div>
      ) : null}

      {replies.length > 0 ? (
        <div className="ml-0 space-y-3 border-border/70 border-l pl-4 sm:ml-11">
          {replies.map((reply) => (
            <CommentThread
              canReply={canReply}
              comment={reply}
              currentUserName={currentUserName}
              key={reply.id}
              onSubmitReply={onSubmitReply}
              repliesByParentId={repliesByParentId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
