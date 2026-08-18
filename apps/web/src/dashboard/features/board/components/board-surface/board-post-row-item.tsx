import { Badge } from "@feeblo/ui/badge";
import { Checkbox } from "@feeblo/ui/checkbox";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import { useBoardStore } from "~/features/board/state/board-store-context";

import { StatusIcon } from "./status-icon";
import type { BoardPostRow } from "./types";
import { formatPostDate } from "./utils";

export function BoardPostRowItem({
  post,
  organizationId,
}: {
  post: BoardPostRow;
  organizationId: string;
}) {
  const store = useBoardStore();
  const checked = useSelector(store, (state) =>
    state.context.selectedPosts.some((entry) => entry.postId === post.id)
  );

  return (
    <div className="group hover:bg-muted/50 mt-1 flex items-center gap-2 rounded-xl px-4 py-3 transition-colors">
      <Checkbox
        aria-label={`Select ${post.title}`}
        checked={checked}
        className="pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-checked:pointer-events-auto data-checked:opacity-100"
        onCheckedChange={(nextChecked) => {
          store.send({
            boardId: post.boardId,
            type: "togglePostSelection",
            checked: nextChecked === true,
            postId: post.id,
          });
        }}
      />

      <Link
        className="flex min-w-0 flex-1 items-center justify-between gap-3"
        params={{
          organizationId,
          boardSlug: post.boardSlug,
          postSlug: post.slug,
        }}
        to="/$organizationId/post/$boardSlug/$postSlug"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Badge className="tabular-nums" variant="secondary">
            <HugeiconsIcon
              className="size-3.5"
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
            />
            {post.upvoteCount}
          </Badge>
          <StatusIcon status={post.status} />
          <p className="truncate text-sm font-medium no-underline!">
            {post.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {post.boardName ? (
            <span className="bg-muted/70 text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
              {post.boardName}
            </span>
          ) : null}
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <UserAvatar
              className="size-5"
              image={post.user.image}
              name={post.user.name}
              size="sm"
            />
            {formatPostDate(post.updatedAt)}
          </span>
        </div>
      </Link>
    </div>
  );
}
