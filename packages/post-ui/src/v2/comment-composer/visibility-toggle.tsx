import { Toggle } from "@feeblo/ui/toggle";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@feeblo/ui/tooltip";
import { CircleLockIcon, CircleUnlockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentComposer } from "./context";

export function VisibilityToggle() {
  const { actions, meta, state } = useCommentComposer();

  const visibilityLabel = state.isPrivate
    ? meta.privateLabel
    : meta.publicLabel;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={
                state.isPrivate ? "Switch to public" : "Switch to internal"
              }
              disabled={state.disabled}
              onPressedChange={(pressed) => actions.onVisibilityChange(pressed)}
              pressed={state.isPrivate}
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon
                icon={state.isPrivate ? CircleLockIcon : CircleUnlockIcon}
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
