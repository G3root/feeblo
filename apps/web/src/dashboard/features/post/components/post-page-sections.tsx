import { PostPage } from "@feeblo/post-ui/post-page";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Skeleton } from "@feeblo/ui/skeleton";
import * as dayjs from "@feeblo/utils/dayjs";
import {
  Calendar03Icon,
  CircleLockIcon,
  DashedLine02Icon,
  DashedLineCircleIcon,
  UserCircleIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { PostStatusSelect } from "~/features/post-status/components/post-status-select";

import { GHOST_PROPERTY_TRIGGER } from "../lib/property-trigger";
import { PostAssigneeField } from "./post-assignee-field";
import { PostAuthorField } from "./post-author-field";
import { PostBoardField } from "./post-board-field";
import { PostEtaField } from "./post-eta-field";

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
      <aside className="px-4 py-6 md:px-6">
        <Skeleton className="h-40 w-full" />
      </aside>
    </div>
  );
}
/**
 * One label/value row in the post's details list.
 *
 * The property fields self-gate and render their own editors, so the row only
 * owns the label/value geometry. The control sits on the right with the same
 * max width as the author and created values, which is what turns the old
 * full-width toolbar buttons into metadata rather than a second toolbar.
 */
export function PostDetailRow({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: typeof UserIcon;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <HugeiconsIcon
        aria-hidden="true"
        className="text-muted-foreground/72 size-4"
        icon={icon}
        strokeWidth={1.75}
      />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground flex max-w-44 min-w-0 justify-end font-medium">
        {children}
      </dd>
    </div>
  );
}

export function PostDetails({
  children,
  createdAt,
}: {
  createdAt: Date | string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="post-details-heading" className="space-y-2.5">
      <h2 className="sr-only" id="post-details-heading">
        Details
      </h2>
      <dl className="space-y-2">
        <PostDetailRow icon={DashedLineCircleIcon} label="Status">
          <PostStatusSelect
            showTrigger={false}
            triggerClassName={GHOST_PROPERTY_TRIGGER}
          />
        </PostDetailRow>
        <PostDetailRow icon={DashedLine02Icon} label="Board">
          <PostBoardField
            showTrigger={false}
            triggerClassName={GHOST_PROPERTY_TRIGGER}
          />
        </PostDetailRow>
        <PostDetailRow icon={UserCircleIcon} label="Assignee">
          <PostAssigneeField />
        </PostDetailRow>
        <PostDetailRow icon={Calendar03Icon} label="ETA">
          <PostEtaField />
        </PostDetailRow>
        <PostDetailRow icon={UserIcon} label="Author">
          <PostAuthorField />
        </PostDetailRow>
        <PostDetailRow icon={Calendar03Icon} label="Created">
          <span className="truncate">{dayjs.default(createdAt).fromNow()}</span>
        </PostDetailRow>
        {children}
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
