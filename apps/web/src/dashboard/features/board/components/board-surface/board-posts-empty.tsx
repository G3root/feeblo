import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

export function BoardPostsEmpty() {
  return (
    <Empty className="rounded-none border-0 py-16">
      <EmptyHeader>
        <EmptyTitle>No posts yet</EmptyTitle>
        <EmptyDescription>
          This board does not have any posts yet. Create one to get started.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
