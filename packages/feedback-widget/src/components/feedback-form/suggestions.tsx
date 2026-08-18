import { For, Show } from "solid-js";

import { useFeedbackForm } from "./context";

export function FeedbackFormSuggestions() {
  const { state } = useFeedbackForm();

  return (
    <Show when={state.suggestions().length > 0}>
      <section
        aria-busy={state.suggestionsPending()}
        aria-label="Similar posts"
        class="bg-muted/40 overflow-hidden rounded-lg border"
      >
        <div class="border-b px-3 py-2">
          <p class="text-sm font-medium">
            {state.suggestionsPending()
              ? "Updating similar posts"
              : "Similar posts"}
          </p>
          <p class="text-muted-foreground text-xs">
            Your idea may already have been shared.
          </p>
        </div>
        <For each={state.suggestions()}>
          {(post) => (
            <div class="flex flex-col gap-0.5 border-b px-3 py-2.5 last:border-b-0">
              <span class="text-sm font-medium">{post.title}</span>
              <Show when={post.excerpt}>
                <span class="text-muted-foreground line-clamp-1 text-xs">
                  {post.excerpt}
                </span>
              </Show>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
