import { Button } from "@feeblo/ui/button";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../../paraglide/messages.js";
import { useCommentComposer } from "./context";

/**
 * The customer staged as the comment's author, shown inside the composer box.
 *
 * Without it, a staged author is invisible once the options popover closes:
 * the only signal was a dot on the trigger, and the next comment submitted
 * was attributed to the customer with no visible warning. Renders nothing
 * while the session user authors.
 */
export function CommentComposerAuthorChip() {
  const { actions, state } = useCommentComposer();

  if (state.authorDisplay === null) {
    return null;
  }

  return (
    <div
      className="mb-2 flex items-center gap-1.5 text-xs"
      data-slot="comment-composer-author"
    >
      <span className="text-muted-foreground">{m.solid_full_shrimp()}:</span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {state.authorDisplay}
      </span>
      {actions.onAuthorClear ? (
        <Button
          aria-label={m.short_teary_seahorse()}
          onClick={actions.onAuthorClear}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      ) : null}
    </div>
  );
}
