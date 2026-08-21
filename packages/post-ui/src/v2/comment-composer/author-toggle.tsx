import { Toggle } from "@feeblo/ui/toggle";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@feeblo/ui/tooltip";
import { UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentComposer } from "./context";

/**
 * "Comment as customer" toggle. Pressing it swaps the composer's authorship
 * to the picked subject; the picker itself arrives through
 * `state.authorPicker`.
 */
export function AuthorToggle() {
  const { actions, state } = useCommentComposer();

  if (!state.showAuthorToggle) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={
                state.isAuthorMode
                  ? "Comment as yourself"
                  : "Comment as customer"
              }
              disabled={state.disabled}
              onPressedChange={(pressed) => actions.onAuthorToggle?.(pressed)}
              pressed={state.isAuthorMode}
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon icon={UserIcon} strokeWidth={2} />
            </Toggle>
          }
        />
        <TooltipPopup>
          {state.isAuthorMode ? "Comment as yourself" : "Comment as customer"}
        </TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}
