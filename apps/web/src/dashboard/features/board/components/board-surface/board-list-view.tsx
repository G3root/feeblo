import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Accordion,
  AccordionContent,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Button } from "~/components/ui/button";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { hasMembership, PolicyGuard } from "~/hooks/use-policy";
import { BOARD_LANE_COLUMN_MAP, type BoardPostStatus } from "../../constants";
import { BoardPostRowItem } from "./board-post-row-item";
import { StatusIcon } from "./status-icon";
import type { BoardPostRow } from "./types";

export function BoardListView({
  boardSlug,
  organizationId,
  boardId,
  groupedPosts,
}: {
  boardSlug: string;
  organizationId: string;
  boardId: string;
  groupedPosts: Record<BoardPostStatus, BoardPostRow[]>;
}) {
  return (
    <section>
      <Accordion
        className="w-full gap-2 rounded-none border-none p-3"
        defaultValue={Object.keys(groupedPosts)}
        multiple
      >
        {Object.keys(groupedPosts).map((lane) => (
          <AccordionPrimitive.Item key={lane} value={lane}>
            <div className="relative">
              <AccordionTrigger className="rounded-xl border-0 bg-muted/70 px-4 py-2.5 pr-14 hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon
                    className="size-4 text-muted-foreground group-aria-expanded/accordion-trigger:hidden"
                    icon={ArrowDown01Icon}
                    strokeWidth={2}
                  />
                  <HugeiconsIcon
                    className="hidden size-4 text-muted-foreground group-aria-expanded/accordion-trigger:inline"
                    icon={ArrowUp01Icon}
                    strokeWidth={2}
                  />
                  <StatusIcon status={lane as BoardPostStatus} />
                  <h3 className="font-medium text-sm">
                    {BOARD_LANE_COLUMN_MAP[lane as BoardPostStatus]}
                  </h3>
                  <span className="text-muted-foreground text-xs">
                    {groupedPosts[lane as BoardPostStatus].length}
                  </span>
                </div>
              </AccordionTrigger>

              <PolicyGuard policy={hasMembership(organizationId)}>
                <AddPostButton
                  boardId={boardId}
                  status={lane as BoardPostStatus}
                />
              </PolicyGuard>
            </div>
            <AccordionContent className="h-auto pb-0" panelClassName="px-0">
              {groupedPosts[lane as BoardPostStatus].map((post) => (
                <BoardPostRowItem
                  boardId={boardId}
                  boardSlug={boardSlug}
                  key={post.id}
                  organizationId={organizationId}
                  post={post}
                />
              ))}
            </AccordionContent>
          </AccordionPrimitive.Item>
        ))}
      </Accordion>
    </section>
  );
}

function AddPostButton({
  boardId,
  status,
}: {
  boardId: string;
  status: BoardPostStatus;
}) {
  const store = usePostCreateDialogContext();
  return (
    <Button
      aria-label={`Add post to ${BOARD_LANE_COLUMN_MAP[status]}`}
      className="absolute top-1/2 right-6 -translate-y-1/2"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        store.send({ type: "toggle", data: { boardId, status } });
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <HugeiconsIcon icon={Add01Icon} />
    </Button>
  );
}
