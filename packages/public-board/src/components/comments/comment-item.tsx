import type { Comment as TComment } from "@feeblo/domain/comments/schema";
import { Ellipsis, Heart, MessageSquare } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { authClient } from "../../lib/auth-client";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { CommentForm } from "./comment-form";

interface CommentItemProps {
  comment: TComment;
}

export function CommentItem({ comment }: CommentItemProps) {
  const [isReplying, setIsReplying] = createSignal(false);
  const session = authClient.useSession();
  return (
    <div class="mb-6">
      <div class="flex gap-3">
        <Avatar>
          <AvatarFallback>{comment.user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div class="flex flex-1 flex-col gap-2">
          <div class="flex flex-col gap-2">
            <div class="rounded-lg bg-muted p-3">
              <div class="mb-1 flex items-center justify-between">
                <div class="font-medium text-sm">{comment.user.name}</div>
                <Button size="icon" variant="ghost">
                  <Ellipsis />
                </Button>
              </div>
              <div class="whitespace-pre-wrap text-muted-foreground text-sm">
                {comment.content}
              </div>
            </div>

            <div class="flex items-center gap-2 text-gray-500 text-xs">
              {/* <time datetime={comment.createdAt.toISOString()}>
                {dayjsExt(comment.createdAt).fromNow()}
              </time> */}
              <div>•</div>
              <Button
                size="sm"
                variant="ghost"
                // class="h-6 px-2 text-xs flex items-center gap-1"
                // onClick={() => onLikeComment(comment.id)}
              >
                <Heart />
                {/* {comment.likes > 0 && <span>{comment.likes}</span>} */}
              </Button>

              <Show when={session().data}>
                <div>•</div>
                <Button
                  onClick={() => setIsReplying((prev) => !prev)}
                  size="sm"
                  variant={isReplying() ? "default" : "ghost"}
                >
                  <MessageSquare />
                  Reply
                </Button>
              </Show>
            </div>
          </div>

          <Show when={isReplying()}>
            <CommentForm buttonText="Reply" currentUser={{ initials: "JD" }} />
          </Show>
        </div>
      </div>
    </div>
  );
}
