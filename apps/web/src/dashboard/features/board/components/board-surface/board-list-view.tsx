import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { BoardPostRowItem } from "./board-post-row-item";
import { StatusIcon } from "./status-icon";
import type { BoardLane } from "./types";

export function BoardListView({
  lanes,
  boardSlug,
  organizationId,
}: {
  lanes: BoardLane[];
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <section>
      <Accordion
        className="w-full"
        defaultValue={lanes.map((lane) => lane.key)}
        multiple
      >
        {lanes.map((lane) => (
          <AccordionItem
            className="border-border border-b last:border-b-0"
            key={lane.key}
            value={lane.key}
          >
            <div className="relative">
              <AccordionTrigger className="rounded-none border-0 bg-linear-to-r from-muted/70 via-muted/30 to-transparent px-4 py-2.5 pr-14 hover:no-underline [&_[data-slot=accordion-trigger-icon]]:hidden">
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
                  <StatusIcon status={lane.status} toneVar={lane.toneVar} />
                  <h3 className="font-medium text-sm">{lane.label}</h3>
                  <span className="text-muted-foreground text-xs">
                    {lane.posts.length}
                  </span>
                </div>
              </AccordionTrigger>

              <button
                aria-label={`Add post to ${lane.label}`}
                className="absolute top-1/2 right-2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                type="button"
              >
                +
              </button>
            </div>
            <AccordionContent className="h-auto pb-0">
              {lane.posts.map((post) => (
                <BoardPostRowItem
                  boardSlug={boardSlug}
                  key={post.slug}
                  organizationId={organizationId}
                  post={post}
                />
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
