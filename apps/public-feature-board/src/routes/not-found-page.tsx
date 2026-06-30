import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border border-border/70 border-dashed bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            The public board route you requested does not exist.
          </EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants({ variant: "outline" })} to="/">
          Back to feedback
        </Link>
      </Empty>
    </div>
  );
}
