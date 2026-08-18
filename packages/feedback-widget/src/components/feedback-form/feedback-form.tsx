import type { JSX } from "solid-js";

import { createFeedBackAction } from "../../lib/api";
import { useFeedbackForm } from "./context";

export function FeedbackFormFrame(props: { children: JSX.Element }) {
  const { meta } = useFeedbackForm();

  return (
    <form
      action={createFeedBackAction}
      class="flex h-full flex-col p-6"
      method="post"
    >
      <input name="boardId" type="hidden" value={meta.board.id} />
      <input name="boardName" type="hidden" value={meta.board.name} />
      {props.children}
    </form>
  );
}
