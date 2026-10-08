import { createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";

import { fetchUpdates } from "../../lib/api";
import { consumeSurfaceEntry } from "../../lib/motion";
import { ViewTransition } from "../shell/view-transition";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { UpdateCard } from "./update-card";
import { UpdatesListSkeleton } from "./updates-list-skeleton";

/**
 * The updates surface's root. Owns its own transition and boundary so the
 * route that renders it stays a one-liner and the skeleton is the list's own
 * shape rather than a generic one.
 */
export function UpdatesList() {
  return (
    <ViewTransition kind="root">
      <Suspense fallback={<UpdatesListSkeleton />}>
        <UpdatesListScreen />
      </Suspense>
    </ViewTransition>
  );
}

function UpdatesListScreen() {
  const updates = createAsync(() => fetchUpdates());
  const staggerRows = consumeSurfaceEntry("updates");

  return (
    <Show keyed when={updates()}>
      {(items) => (
        <div class="p-6">
          <header>
            <h1 class="text-foreground text-lg font-medium">Product updates</h1>
            <p class="text-muted-foreground mt-1 text-sm">
              New improvements, fixes, and releases.
            </p>
          </header>

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
            when={items.length > 0}
          >
            <ul class="mt-6 flex flex-col gap-3">
              <For each={items}>
                {(update, index) => (
                  <li
                    class={staggerRows ? "widget-stagger" : undefined}
                    style={
                      staggerRows
                        ? { "--stagger": Math.min(index(), 6) }
                        : undefined
                    }
                  >
                    <UpdateCard update={update} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      )}
    </Show>
  );
}
