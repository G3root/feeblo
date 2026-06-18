import type { JSX } from "solid-js";

export function FeedbackFormActions(props: { children: JSX.Element }) {
  return (
    <div class="mt-4 flex w-full justify-between gap-3">{props.children}</div>
  );
}

export function FeedbackFormActionsSecondary(props: { children: JSX.Element }) {
  return <div class="flex gap-3">{props.children}</div>;
}
