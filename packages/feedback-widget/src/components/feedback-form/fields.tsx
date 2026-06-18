import type { JSX } from "solid-js";

export function FeedbackFormFields(props: { children: JSX.Element }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {props.children}
    </div>
  );
}
