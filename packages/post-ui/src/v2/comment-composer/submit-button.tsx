import { Button } from "@feeblo/ui/button";
import { Group, GroupSeparator } from "@feeblo/ui/group";

import { m } from "../../paraglide/messages.js";
import { useCommentComposer, useCommentComposerIsDisabled } from "./context";
import { CommentOptionsMenu } from "./options-menu";
import { useCommentComposerState } from "./store";

export function SubmitButton() {
  const { actions, meta, state } = useCommentComposer();
  const isPrivate = useCommentComposerState((context) => context.isPrivate);
  const isDisabled = useCommentComposerIsDisabled();

  const hasOptionsMenu =
    state.showAuthorToggle || state.statusOptions.length > 0;

  return (
    <Group>
      <Button
        disabled={isDisabled}
        size="sm"
        type={actions.onSubmit ? "button" : "submit"}
        variant="brand"
        {...(actions?.onSubmit
          ? {
              onClick: actions.onSubmit,
            }
          : {})}
      >
        {meta.submitLabel ??
          (isPrivate ? m.due_any_skunk() : m.aloof_dirty_goldfish())}
      </Button>
      {hasOptionsMenu ? (
        <>
          <GroupSeparator className="bg-brand-ring/72" />
          <CommentOptionsMenu />
        </>
      ) : null}
    </Group>
  );
}
