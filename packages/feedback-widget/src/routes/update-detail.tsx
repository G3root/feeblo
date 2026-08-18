import { createAsync, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";

import { UpdateDetail } from "../components/updates/update-detail";
import { fetchUpdates } from "../lib/api";

export default function UpdateDetailRoute() {
  const params = useParams();
  const updates = createAsync(() => fetchUpdates());
  const update = createMemo(() =>
    updates()?.find((item) => item.id === params.updateId)
  );

  return (
    <Show
      fallback={
        <p class="text-muted-foreground p-6 text-sm">Update not found.</p>
      }
      keyed
      when={update()}
    >
      {(item) => <UpdateDetail update={item} />}
    </Show>
  );
}
