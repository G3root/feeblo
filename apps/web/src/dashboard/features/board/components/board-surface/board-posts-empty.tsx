import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

export function BoardPostsEmpty({ boardId }: { boardId: string }) {
  const store = usePostCreateDialogContext();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No posts yet</EmptyTitle>
        <EmptyDescription>
          This board does not have any posts yet. Create one to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          onClick={() =>
            store.send({ type: "toggle", data: { boardId, status: "PLANNED" } })
          }
        >
          Create post
        </Button>
      </EmptyContent>
    </Empty>
  );
}
