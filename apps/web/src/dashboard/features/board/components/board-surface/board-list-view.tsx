import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import {
  Accordion,
  AccordionPanel,
  AccordionTrigger,
} from "@feeblo/ui/accordion";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@feeblo/ui/context-menu";
import {
  type BoardPostStatus,
  getBoardStatusLabel,
} from "@feeblo/web-shared/board/constants";
import { hasMembership, PolicyGuard } from "@feeblo/web-shared/use-policy";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";

import {
  useBoardStore,
  useSelectedPosts,
} from "~/features/board/state/board-store-context";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

import { BoardPostRowItem } from "./board-post-row-item";
import { StatusIcon } from "./status-icon";
import type { BoardPostLane, BoardPostRow } from "./types";

export function BoardListView({
  organizationId,
  boardId,
  groupedPosts,
}: {
  organizationId: string;
  boardId?: string;
  groupedPosts: BoardPostLane[];
}) {
  return (
    <section>
      <Accordion
        className="w-full gap-2 rounded-none border-none p-3"
        defaultValue={groupedPosts.map((lane) => lane.statusId)}
        multiple
      >
        {groupedPosts.map((lane) => (
          <BoardListLane
            boardId={boardId}
            key={lane.statusId}
            lane={lane}
            organizationId={organizationId}
          />
        ))}
      </Accordion>
    </section>
  );
}

const BoardListLane = memo(function BoardListLane({
  boardId,
  lane,
  organizationId,
}: {
  boardId?: string;
  lane: BoardPostLane;
  organizationId: string;
}) {
  return (
    <AccordionPrimitive.Item value={lane.statusId}>
      <BoardListLaneHeader
        boardId={boardId}
        lane={lane}
        organizationId={organizationId}
      />
      <AccordionPanel className="h-auto px-0 pb-0">
        {lane.posts.map((post) => (
          <BoardPostRowItem
            key={post.id}
            organizationId={organizationId}
            post={post}
          />
        ))}
      </AccordionPanel>
    </AccordionPrimitive.Item>
  );
});

function BoardListLaneHeader({
  boardId,
  lane,
  organizationId,
}: {
  boardId?: string;
  lane: BoardPostLane;
  organizationId: string;
}) {
  const store = useBoardStore();

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <div className="relative">
          <AccordionTrigger className="group/accordion-trigger bg-muted/70 rounded-xl border-0 px-4 py-2.5 pr-14 hover:no-underline **:data-[slot=accordion-indicator]:hidden">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                className="text-muted-foreground size-4 group-aria-expanded/accordion-trigger:hidden"
                icon={ArrowDown01Icon}
                strokeWidth={2}
              />
              <HugeiconsIcon
                className="text-muted-foreground hidden size-4 group-aria-expanded/accordion-trigger:inline"
                icon={ArrowUp01Icon}
                strokeWidth={2}
              />
              <StatusIcon status={lane.status} />
              <h3 className="text-sm font-medium">
                {getBoardStatusLabel(lane.status)}
              </h3>
              <span className="text-muted-foreground text-xs">
                {lane.posts.length}
              </span>
              <LaneSelectedCounter posts={lane.posts} />
            </div>
          </AccordionTrigger>

          <PolicyGuard policy={hasMembership(organizationId)}>
            {({ allowed }) => (
              <AddPostButton
                boardId={boardId}
                disabled={!allowed}
                status={lane.status}
                statusId={lane.statusId}
              />
            )}
          </PolicyGuard>
        </div>
      </ContextMenuTrigger>

      <ContextMenuPopup align="start">
        <ContextMenuItem
          disabled={lane.posts.length === 0}
          onClick={() => {
            store.send({
              type: "selectPosts",
              posts: lane.posts.map((post) => ({
                boardId: post.boardId,
                postId: post.id,
              })),
            });
          }}
        >
          Select all posts in this lane
        </ContextMenuItem>
        <ContextMenuSeparator />
        <LaneUnselectMenuItem posts={lane.posts} />
      </ContextMenuPopup>
    </ContextMenu>
  );
}

function LaneSelectedCounter({ posts }: { posts: BoardPostRow[] }) {
  const selectedCount = useLaneSelectedCount(posts);

  if (selectedCount === 0) {
    return null;
  }

  return (
    <Badge
      className="rounded-full group-aria-expanded/accordion-trigger:hidden"
      size="sm"
      variant="default"
    >
      {selectedCount}
    </Badge>
  );
}

function LaneUnselectMenuItem({ posts }: { posts: BoardPostRow[] }) {
  const store = useBoardStore();
  const selectedCount = useLaneSelectedCount(posts);

  return (
    <ContextMenuItem
      disabled={selectedCount === 0}
      onClick={() => {
        store.send({
          type: "deselectPosts",
          postIds: posts.map((post) => post.id),
        });
      }}
    >
      Unselect all posts in this lane
    </ContextMenuItem>
  );
}

function useLaneSelectedCount(posts: BoardPostRow[]) {
  const selectedPosts = useSelectedPosts();
  const selectedIds = new Set(selectedPosts.map((entry) => entry.postId));

  return posts.reduce(
    (count, post) => count + (selectedIds.has(post.id) ? 1 : 0),
    0
  );
}

function AddPostButton({
  boardId,
  disabled = false,
  status,
  statusId,
}: {
  boardId?: string;
  disabled?: boolean;
  status: BoardPostStatus;
  statusId: string;
}) {
  const store = usePostCreateDialogContext();

  return (
    <Button
      aria-label={`Add post to ${getBoardStatusLabel(status)}`}
      className="absolute top-1/2 right-6 -translate-y-1/2"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        store.send({
          type: "toggle",
          data: { boardId, source: "board_list", status, statusId },
        });
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <HugeiconsIcon icon={Add01Icon} />
    </Button>
  );
}
