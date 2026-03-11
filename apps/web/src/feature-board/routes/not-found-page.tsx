import { buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border border-dashed border-border/70 bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            The public board route you requested does not exist.
          </EmptyDescription>
        </EmptyHeader>
        <a className={buttonVariants({ variant: "outline" })} href="/">
          Back to feedback
        </a>
      </Empty>
    </div>
  );
}
