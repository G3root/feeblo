import type { JSX } from "solid-js";

export function FeedbackFormFrame(props: { children: JSX.Element }) {
  return <div class="flex h-full flex-col p-6">{props.children}</div>;
}
