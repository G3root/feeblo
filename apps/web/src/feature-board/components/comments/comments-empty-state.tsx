import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export function CommentsEmptyState() {
  return (
    <Empty className="border border-border/70 border-dashed bg-muted/20">
      <EmptyHeader>
        <EmptyMedia variant="icon">0</EmptyMedia>
        <EmptyTitle>No comments yet</EmptyTitle>
        <EmptyDescription>
          Start the discussion when you are ready.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
