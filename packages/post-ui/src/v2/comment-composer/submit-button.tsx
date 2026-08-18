import { Button } from "@feeblo/ui/button";

import { useCommentComposer } from "./context";

export function SubmitButton() {
  const { actions, meta, state } = useCommentComposer();
  return (
    <Button
      disabled={state.disabled}
      size="sm"
      type={actions.onSubmit ? "button" : "submit"}
      variant={state.isPrivate ? "default" : "outline"}
      {...(actions?.onSubmit
        ? {
            onClick: actions.onSubmit,
          }
        : {})}
    >
      {meta.submitLabel ??
        (state.isPrivate
          ? `Comment ${meta.privateLabel}`
          : `Comment ${meta.publicLabel}`)}
    </Button>
  );
}