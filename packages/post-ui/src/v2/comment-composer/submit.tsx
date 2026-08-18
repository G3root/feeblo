import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";

import { useCommentComposer } from "./context";
import { SubmitButton } from "./submit-button";
import { VisibilityToggle } from "./visibility-toggle";

export function CommentComposerSubmit() {
  const { actions, meta, state } = useCommentComposer();

  return (
    <div
      className={cn(
        "flex items-center pt-2",
        state.showVisibilityToggle ? "justify-between" : "justify-end"
      )}
    >
      {state.showVisibilityToggle ? <VisibilityToggle /> : null}
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