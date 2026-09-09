import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Link } from "@tanstack/react-router";

import { m } from "../paraglide/messages.js";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border-border/70 bg-muted/20 border border-dashed">
        <EmptyHeader>
          <EmptyTitle>{m.salty_empty_shrike()}</EmptyTitle>
          <EmptyDescription>{m.true_upper_antelope()}</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants({ variant: "outline" })} to="/">
          {m.orange_male_bumblebee()}
        </Link>
      </Empty>
    </div>
  );
}
