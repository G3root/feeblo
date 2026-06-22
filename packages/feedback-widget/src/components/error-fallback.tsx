import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";

export function ErrorFallback(props: { error: unknown }) {
  const message =
    props.error instanceof Error
      ? props.error.message
      : "An unexpected error occurred";

  return (
    <div class="flex h-full items-center justify-center p-6">
      <Empty class="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
