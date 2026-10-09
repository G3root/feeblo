import type { JSX } from "solid-js";

export function FeedbackFormFields(props: { children: JSX.Element }) {
  return (
    <div class="flex flex-1 flex-col gap-3 px-6 pt-4 pb-4">
      {props.children}
    </div>
  );
}
