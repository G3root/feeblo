import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { Checkbox } from "~/components/ui/checkbox";
import { usePostSelectionStore } from "~/features/board/state/post-selection-context";
import { StatusIcon } from "./status-icon";
import type { BoardPostRow } from "./types";
import { formatPostDate } from "./utils";

export function BoardPostRowItem({
  post,
  boardSlug,
  organizationId,
  boardId,
}: {
  post: BoardPostRow;
  boardSlug: string;
  organizationId: string;
  boardId: string;
}) {
  const store = usePostSelectionStore();
  const checked = useSelector(store, (state) =>
    state.context.selectedPostIds.includes(post.id)
  );

  return (
    <div className="group flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/50">
      <Checkbox
        aria-label={`Select ${post.title}`}
        checked={checked}
        className="pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-checked:pointer-events-auto data-checked:opacity-100"
        onCheckedChange={(nextChecked) => {
          store.send({
            type: "togglePostSelection",
            checked: nextChecked === true,
            postId: post.id,
          });
          const previousBoardId = store.get().context.boardId;
          if (previousBoardId !== boardId) {
            store.send({
              type: "setBoardId",
              boardId,
            });
          }
        }}
      />
      <Link
        className="flex min-w-0 flex-1 items-center justify-between gap-3"
        params={{
          organizationId,
          boardSlug,
          postSlug: post.slug,
        }}
        to="/$organizationId/board/$boardSlug/$postSlug"
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
