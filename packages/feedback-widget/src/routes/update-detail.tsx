import { createAsync, useParams } from "@solidjs/router";
import { Show, Suspense } from "solid-js";

import { ViewTransition } from "../components/shell/view-transition";
import {
  UpdateDetail,
  UpdateNotFound,
} from "../components/updates/update-detail";
import { UpdateDetailSkeleton } from "../components/updates/update-detail-skeleton";
import { fetchUpdates } from "../lib/api";

export default function UpdateDetailRoute() {
  return (
    <ViewTransition kind="push">
      <Suspense fallback={<UpdateDetailSkeleton />}>
        <UpdateDetailScreen />
      </Suspense>
    </ViewTransition>
  );
}

function UpdateDetailScreen() {
  const params = useParams();
  const updates = createAsync(() => fetchUpdates());

  return (
    <Show
      fallback={<UpdateNotFound />}
      keyed
      when={updates()?.find((item) => item.id === params.updateId)}
    >
      {(update) => <UpdateDetail update={update} />}
    </Show>
  );
}
