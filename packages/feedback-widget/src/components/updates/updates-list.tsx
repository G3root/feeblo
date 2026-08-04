import { A, createAsync } from "@solidjs/router";
import { ErrorBoundary, For, Show } from "solid-js";
import { fetchUpdates } from "../../lib/api";
import { PoweredByBadge } from "../board-list/powered-by-badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function UpdatesList() {
  const updates = createAsync(() => fetchUpdates());

  return (
    <div class="p-6">
      <header class="pr-12">
        <p class="font-medium text-foreground text-lg">Product updates</p>
        <p class="mt-1 text-muted-foreground text-sm">
          New improvements, fixes, and releases.
        </p>
      </header>

      <ErrorBoundary
        fallback={
          <Empty class="mt-6 border">
            <EmptyHeader>
              <EmptyTitle>Updates unavailable</EmptyTitle>
              <EmptyDescription>
                Product updates could not be loaded. Try again later.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      >
        <Show
          fallback={
            <p class="py-14 text-center text-muted-foreground text-sm">
              Loading updates…
            </p>
          }
          keyed
          when={updates()}
        >
          {(items) => (
            <Show
              fallback={
                <Empty class="mt-6 border">
                  <EmptyHeader>
                    <EmptyTitle>No updates yet</EmptyTitle>
                    <EmptyDescription>
                      Published product updates will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
              keyed
              when={items.length > 0}
            >
              <div class="mt-6 space-y-3">
                <For each={items}>
                  {(update) => (
                    <A
                      class="group block overflow-hidden rounded-xl border bg-card transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/30"
                      href={`/updates/${update.id}`}
                    >
                      <Show when={update.imageUrl}>
                        {(imageUrl) => (
                          <img
                            alt=""
                            class="h-32 w-full border-b object-cover"
                            height="128"
                            loading="lazy"
                            src={imageUrl()}
                            width="352"
                          />
                        )}
                      </Show>
                      <article class="p-4">
                        <time class="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
                          {dateFormatter.format(new Date(update.publishedAt))}
                        </time>
                        <h2 class="mt-2 font-semibold text-base leading-snug tracking-tight">
                          {update.title}
                        </h2>
                        <Show when={update.excerpt}>
                          <p class="mt-1.5 line-clamp-2 text-muted-foreground text-sm leading-relaxed">
                            {update.excerpt}
                          </p>
                        </Show>
                      </article>
                    </A>
                  )}
                </For>
              </div>
              <PoweredByBadge />
            </Show>
          )}
        </Show>
      </ErrorBoundary>
    </div>
  );
}
