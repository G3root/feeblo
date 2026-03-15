import { Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export function CommentsEmptyState() {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Comment01Icon} />
        </EmptyMedia>
        <EmptyTitle>No comments yet</EmptyTitle>
        <EmptyDescription>
          Start the discussion when you are ready.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
