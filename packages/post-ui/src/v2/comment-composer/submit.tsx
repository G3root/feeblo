import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";

import { AuthorToggle } from "./author-toggle";
import { useCommentComposer } from "./context";
import { SubmitButton } from "./submit-button";
import { VisibilityToggle } from "./visibility-toggle";

export function CommentComposerSubmit() {
  const { actions, meta, state } = useCommentComposer();

  const hasLeftControls = state.showVisibilityToggle || state.showAuthorToggle;

  return (
    <>
      {state.isAuthorMode && state.authorPicker ? (
        <div className="pb-2">{state.authorPicker}</div>
      ) : null}
      <div
        className={cn(
          "flex items-center pt-2",
          hasLeftControls ? "justify-between" : "justify-end"
        )}
      >
        {hasLeftControls ? (
          <div className="flex items-center gap-1">
            {state.showVisibilityToggle ? <VisibilityToggle /> : null}
            <AuthorToggle />
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
    </>
  );
}
