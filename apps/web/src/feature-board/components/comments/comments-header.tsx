import { Button } from "~/components/ui/button";

export function CommentsHeader({ totalComments }: { totalComments: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-muted-foreground text-sm">
        {totalComments} {totalComments === 1 ? "comment" : "comments"}
      </div>
      <Button disabled size="sm" variant="outline">
        Newest
      </Button>
    </div>
  );
}
