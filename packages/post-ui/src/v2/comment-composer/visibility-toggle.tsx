import { Toggle } from "@feeblo/ui/toggle";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@feeblo/ui/tooltip";
import { CircleLockIcon, CircleUnlockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  useCommentComposer,
  useCommentComposerIsDisabled,
} from "./context";
import { useCommentComposerState } from "./store";

export function VisibilityToggle() {
  const { actions, meta, state } = useCommentComposer();
  const isPrivate = useCommentComposerState((context) => context.isPrivate);
  const isDisabled = useCommentComposerIsDisabled();

  if (!state.showVisibilityToggle) {
    return null;
  }

  const visibilityLabel = isPrivate ? meta.privateLabel : meta.publicLabel;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={isPrivate ? "Switch to public" : "Switch to internal"}
              disabled={isDisabled}
              onPressedChange={(pressed) => actions.onVisibilityChange(pressed)}
              pressed={isPrivate}
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon
                icon={isPrivate ? CircleLockIcon : CircleUnlockIcon}
                strokeWidth={2}
              />
            </Toggle>
          }
        />
        <TooltipPopup>{visibilityLabel}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}
