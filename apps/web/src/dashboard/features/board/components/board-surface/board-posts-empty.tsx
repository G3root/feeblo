import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { PolicyGuard, hasMembership } from "~/hooks/use-policy";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

export function BoardPostsEmpty({
  boardId,
  organizationId,
}: {
  boardId?: string;
  organizationId: string;
}) {
  const store = usePostCreateDialogContext();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No posts yet</EmptyTitle>
        <EmptyDescription>
          {boardId
            ? "This board does not have any posts yet. Create one to get started."
            : "This workspace does not have any feedback yet."}
        </EmptyDescription>
      </EmptyHeader>
      {boardId ? (
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
