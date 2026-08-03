import { createAsync, useNavigate, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { Button } from "../components/ui/button";
import { fetchUpdates } from "../lib/api";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default function UpdateDetailRoute() {
  const navigate = useNavigate();
  const params = useParams();
  const updates = createAsync(() => fetchUpdates());
  const update = createMemo(() =>
    updates()?.find((item) => item.id === params.updateId)
  );

  return (
    <Show
      fallback={
        <p class="p-6 text-muted-foreground text-sm">Update not found.</p>
      }
      keyed
      when={update()}
    >
      {(item) => (
        <article class="p-6">
          <Button
            onClick={() => navigate("/updates")}
            size="sm"
            variant="outline"
          >
            <span aria-hidden="true">←</span>
            All updates
          </Button>
          <header class="mt-8 pr-10">
            <time class="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
              {dateFormatter.format(new Date(item.publishedAt))}
            </time>
            <h1 class="mt-2 font-semibold text-2xl leading-tight tracking-tight">
              {item.title}
            </h1>
          </header>
          <div
            class="widget-update-content mt-6 text-sm leading-7"
            innerHTML={item.content}
          />
        </article>
      )}
    </Show>
  );
}
