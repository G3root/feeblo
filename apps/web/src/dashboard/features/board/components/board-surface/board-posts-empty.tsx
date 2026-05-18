/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { hasMembership, PolicyGuard } from "~/hooks/use-policy";

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
    <Empty>
      <EmptyHeader>
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
      {boardId && !hasFilters ? (
        <EmptyContent>
          <PolicyGuard policy={hasMembership(organizationId)}>
            <Button
              onClick={() =>
                store.send({
                  type: "toggle",
                  data: { boardId, status: "PLANNED" },
                })
              }
            >
              Create post
            </Button>
          </PolicyGuard>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
