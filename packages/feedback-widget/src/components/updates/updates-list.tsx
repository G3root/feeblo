import { A, createAsync } from "@solidjs/router";
import { ErrorBoundary, For, Show } from "solid-js";

import { fetchUpdates } from "../../lib/api";
import { Card } from "../ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { PoweredByBadge } from "../ui/powered-by-badge";

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
        <p class="text-foreground text-lg font-medium">Product updates</p>
        <p class="text-muted-foreground mt-1 text-sm">
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
            <p class="text-muted-foreground py-14 text-center text-sm">
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
                    <Card
                      class="group hover:border-foreground/20 focus-visible:ring-ring/30 overflow-hidden rounded-xl transition-[border-color,transform,box-shadow] before:rounded-[calc(var(--radius-xl)-1px)] hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-3"
                      href={`/updates/${update.id}`}
                      render={A}
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
                        <time class="text-muted-foreground text-[11px] font-medium tracking-[0.12em] uppercase">
                          {dateFormatter.format(new Date(update.publishedAt))}
                        </time>
                        <h2 class="mt-2 text-base leading-snug font-semibold tracking-tight">
                          {update.title}
                        </h2>
                        <Show when={update.excerpt}>
                          <p class="text-muted-foreground text-sm">
                            {update.excerpt}
                          </p>
                        </Show>
                      </article>
                    </Card>
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
