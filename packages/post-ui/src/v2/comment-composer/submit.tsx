import { Button } from "@feeblo/ui/button";

import { useCommentComposer } from "./context";
import { SubmitButton } from "./submit-button";
import { VisibilityToggle } from "./visibility-toggle";

export function CommentComposerSubmit() {
  const { actions, meta, state } = useCommentComposer();

  return (
    <div
      className={
        state.showVisibilityToggle
          ? "flex items-center justify-between pt-3"
          : "flex items-center justify-end pt-3"
      }
    >
      {state.showVisibilityToggle ? (
        <div className="flex items-center gap-1">
          <VisibilityToggle />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {actions.onCancel ? (
          <Button onClick={actions.onCancel} size="sm" variant="ghost">
            {meta.cancelLabel}
          </Button>
        ) : null}
        <SubmitButton />
      </div>
    </div>
  );
}
