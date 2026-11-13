import { useAtomValue } from "@effect/atom-react";
import { Skeleton } from "@feeblo/ui/skeleton";
import { EyeIcon } from "@hugeicons/core-free-icons";
import * as Result from "effect/reactivity/AsyncResult";

import { postViewCountAtom } from "../atoms";
import { PostDetailRow } from "./post-page-sections";

const viewFormat = new Intl.NumberFormat();

/**
 * The post's all-time views in the details list.
 *
 * The breakdowns live in the Analytics tab, which fetches them only when it is
 * opened or prefetched. Keeping the sidebar to the counter is what keeps a
 * post's first load from paying for four breakdown queries nobody asked for.
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
  const result = useAtomValue(postViewCountAtom({ organizationId, postId }));

  return Result.builder(result)
    .onInitial(() => (
      <PostDetailRow icon={EyeIcon} label="Views">
        <Skeleton className="h-3 w-10" />
      </PostDetailRow>
    ))
    .onFailure(() => null)
    .onSuccess((count) => (
      <PostDetailRow icon={EyeIcon} label="Views">
        <span className="tabular-nums">{viewFormat.format(count.views)}</span>
      </PostDetailRow>
    ))
    .exhaustive();
}
