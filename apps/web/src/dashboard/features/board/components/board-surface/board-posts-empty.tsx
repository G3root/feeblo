/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
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

export function BoardPostsEmpty({
  boardId,
  hasFilters = false,
  organizationId,
}: {
  boardId?: string;
  hasFilters?: boolean;
  organizationId: string;
}) {
  const store = usePostCreateDialogContext();
  return (
    <div className="p-3">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={MessageMultiple01Icon} />
          </EmptyMedia>
          <EmptyTitle>
            {hasFilters ? "No posts match this filter" : "No posts yet"}
          </EmptyTitle>
          <EmptyDescription>
            {hasFilters
              ? "Try a different title search or clear the current filters."
              : boardId
                ? "This board does not have any posts yet. Create one to get started."
                : "This workspace does not have any feedback yet."}
          </EmptyDescription>
        </EmptyHeader>
        {hasFilters ? null : (
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
        )}
      </Empty>
    </div>
  );
}
