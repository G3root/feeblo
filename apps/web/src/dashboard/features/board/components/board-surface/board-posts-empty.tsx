import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { hasMembership, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { MessageMultiple01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

import type { MyFeedbackView } from "../../lib/my-feedback-views";

export function BoardPostsEmpty({
  boardId,
  hasFilters = false,
  myFeedbackView,
  organizationId,
}: {
  boardId?: string;
  hasFilters?: boolean;
  /** Set on the member's own feedback page, which needs its own words. */
  myFeedbackView?: MyFeedbackView;
  organizationId: string;
}) {
  const store = usePostCreateDialogContext();
  const { description, title } = emptyCopy({
    boardId,
    hasFilters,
    myFeedbackView,
  });
  // Creating from `Assigned` would land a post the page it was created from
  // does not list: assignment is a triage decision made after the write.
  const canCreate = !hasFilters && myFeedbackView !== "assigned";

  return (
    <div className="p-3">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={MessageMultiple01Icon} />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {canCreate ? (
          <EmptyContent>
            <PolicyGuard policy={hasMembership(organizationId)}>
              {({ allowed }) => (
                <Button
                  disabled={!allowed}
                  onClick={() =>
                    store.send({
                      type: "toggle",
                      data: {
                        boardId,
                        source: "board_empty_state",
                        status: "PLANNED",
                      },
                    })
                  }
                  variant="brand"
                >
                  <HugeiconsIcon icon={Plus} /> Create post
                </Button>
              )}
            </PolicyGuard>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}

/**
 * What an empty list says.
 *
 * The member's own page cannot reuse the workspace copy — "This workspace does
 * not have any feedback yet" is false there, and there is no clearable filter
 * to blame — so each scope names itself and what would fill it.
 */
function emptyCopy({
  boardId,
  hasFilters,
  myFeedbackView,
}: {
  boardId: string | undefined;
  hasFilters: boolean;
  myFeedbackView: MyFeedbackView | undefined;
}) {
  if (hasFilters) {
    return {
      description: "Try a different title search or clear the current filters.",
      title: "No posts match this filter",
    };
  }

  if (myFeedbackView === "created") {
    return {
      description: "Posts you create will show up here.",
      title: "Nothing created by you yet",
    };
  }

  if (myFeedbackView === "assigned") {
    return {
      description: "Posts assigned to you will show up here.",
      title: "Nothing assigned to you yet",
    };
  }

  return {
    description: boardId
      ? "This board does not have any posts yet. Create one to get started."
      : "This workspace does not have any feedback yet.",
    title: "No posts yet",
  };
}
