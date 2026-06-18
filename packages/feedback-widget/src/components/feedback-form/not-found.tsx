import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

export function BoardNotFound() {
  return (
    <div class="flex h-full items-center justify-center p-6">
      <Empty class="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyTitle>Board not found</EmptyTitle>
          <EmptyDescription>
            The board you were looking for is no longer available
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
