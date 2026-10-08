import type { JSX } from "solid-js";

import { createFeedBackAction } from "../../lib/api";
import { useFeedbackForm } from "./context";

export function FeedbackFormFrame(props: { children: JSX.Element }) {
  const { meta } = useFeedbackForm();

  return (
    <form
      action={createFeedBackAction}
      class="flex min-h-full flex-col"
      method="post"
    >
      <input name="boardId" type="hidden" value={meta.board.id} />
      <input name="boardName" type="hidden" value={meta.board.name} />
      {props.children}
    </form>
  );
}
