import { PostPage } from "@feeblo/post-ui/post-page";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Skeleton } from "@feeblo/ui/skeleton";
import * as dayjs from "@feeblo/utils/dayjs";
import {
  Calendar03Icon,
  CircleLockIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { PostAuthorField } from "./post-author-field";

export function PostPageSkeleton() {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
        <section className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-2/3" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="flex items-center justify-between py-1">
            <Skeleton className="h-7 w-28 rounded-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-10 w-full" />
        </section>
      </div>
      <aside className="px-6 py-6">
        <Skeleton className="h-40 w-full" />
      </aside>
    </div>
  );
}
export function PostDetails({ createdAt }: { createdAt: Date | string }) {
  return (
    <section aria-labelledby="post-details-heading" className="space-y-2.5">
      <h2 className="sr-only" id="post-details-heading">
        Details
      </h2>
      <dl className="space-y-2">
        <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <HugeiconsIcon
            aria-hidden="true"
            className="text-muted-foreground/72 size-4"
            icon={UserIcon}
            strokeWidth={1.75}
          />
          <dt className="text-muted-foreground">Author</dt>
          <dd className="text-foreground max-w-32 font-medium">
            <PostAuthorField />
          </dd>
        </div>
        <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <HugeiconsIcon
            aria-hidden="true"
            className="text-muted-foreground/72 size-4"
            icon={Calendar03Icon}
            strokeWidth={1.75}
          />
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground max-w-32 truncate font-medium">
            {dayjs.default(createdAt).fromNow()}
          </dd>
        </div>
      </dl>
    </section>
  );
}
export function PostStatusAlerts() {
  return (
    <PostPage.Locked>
      <Alert variant="info">
        <HugeiconsIcon icon={CircleLockIcon} />
        <AlertTitle>Locked post</AlertTitle>
        <AlertDescription>
          This post is locked, so members cannot continue interacting with it
          until it is unlocked.
        </AlertDescription>
      </Alert>
    </PostPage.Locked>
  );
}
