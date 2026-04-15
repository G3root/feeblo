import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { Checkbox } from "~/components/ui/checkbox";
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
    <div className="group mt-1 flex items-center gap-2 rounded-xl px-4 py-3 transition-colors hover:bg-muted/50">
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
          <StatusIcon status={post.status} />
          <p className="no-underline! font-medium text-sm">{post.title}</p>
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">
          {formatPostDate(post.updatedAt)}
        </span>
      </Link>
    </div>
  );
}
