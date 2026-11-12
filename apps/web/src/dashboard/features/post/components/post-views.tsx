import { useAtomValue } from "@effect/atom-react";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Calendar03Icon, EyeIcon, GlobeIcon } from "@hugeicons/core-free-icons";
import * as Result from "effect/reactivity/AsyncResult";

import { postTrafficAtom } from "../atoms";
import { PostDetailRow } from "./post-page-sections";

const viewFormat = new Intl.NumberFormat();

const formatViews = (views: number): string => viewFormat.format(views);

/**
 * The traffic rows in the post's details list.
 *
 * All time is the counter; the 30-day figure and the "from" line are the
 * event window. The "from" line is the most common country and device, not a
 * full breakdown — the sidebar is for orientation, and a dashboard page that
 * tries to be an analytics product starts lying about what one number means.
 *
 * A failed read renders nothing rather than an error: traffic is supplementary
 * to the post, and a database blip should not put a red box in the sidebar.
 */
export function PostViews({
  organizationId,
  postId,
}: {
  readonly organizationId: string;
  readonly postId: string;
}) {
  const result = useAtomValue(postTrafficAtom({ organizationId, postId }));

  return Result.builder(result)
    .onInitial(() => (
      <PostDetailRow icon={EyeIcon} label="Views">
        <Skeleton className="h-3 w-10" />
      </PostDetailRow>
    ))
    .onFailure(() => null)
    .onSuccess((traffic) => {
      const from = [
        traffic.last30Days.countries[0]?.value,
        traffic.last30Days.devices[0]?.value,
      ]
        .filter((value): value is string => value !== undefined && value !== "")
        .join(" · ");

      return (
        <>
          <PostDetailRow icon={EyeIcon} label="Views">
            <span className="tabular-nums">{formatViews(traffic.views)}</span>
          </PostDetailRow>
          <PostDetailRow icon={Calendar03Icon} label="Last 30 days">
            <span className="tabular-nums">
              {formatViews(traffic.last30Days.views)}
            </span>
          </PostDetailRow>
          {from === "" ? null : (
            <PostDetailRow icon={GlobeIcon} label="From">
              <span className="truncate">{from}</span>
            </PostDetailRow>
          )}
        </>
      );
    })
    .exhaustive();
}
