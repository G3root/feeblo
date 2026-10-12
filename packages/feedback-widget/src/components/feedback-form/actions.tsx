import type { JSX } from "solid-js";

/**
 * The composer's action bar. It sticks to the bottom of the shell's scroller
 * so the submit stays reachable while the fields and the suggestion panel
 * grow above it.
 */
export function FeedbackFormActions(props: { children: JSX.Element }) {
  return (
    <div class="bg-popover sticky bottom-0 mt-auto flex flex-col gap-3 border-t p-4">
      {props.children}
    </div>
  );
}
