import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { Separator } from "@feeblo/ui/separator";
import { Cancel01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { StatusField } from "../post-field";
import { useCommentComposer, useCommentComposerIsDisabled } from "./context";
import { useCommentComposerState } from "./store";

/**
 * The "more options" popover next to the comment submit button. Two mutually
 * exclusive sections: commenting as a customer (the host's author picker)
 * and posting the comment as a status update (the shared status input).
 * Picking one disables the other; each clears through its own dismiss
 * control, which is how you switch between them.
 */
export function CommentOptionsMenu() {
  const { actions, meta, state } = useCommentComposer();
  const statusUpdateId = useCommentComposerState(
    (context) => context.statusUpdateId
  );
  const isDisabled = useCommentComposerIsDisabled();

  const showAuthor = state.showAuthorToggle;
  const showStatus = state.statusOptions.length > 0;
  if (!showAuthor && !showStatus) {
    return null;
  }

  const selectedStatus =
    statusUpdateId === null
      ? null
      : (state.statusOptions.find((option) => option.id === statusUpdateId) ??
        null);
  const authorSelected = state.authorDisplay !== null;
  const statusSelected = selectedStatus !== null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              selectedStatus
                ? `Status update: ${selectedStatus.label}`
                : "Comment options"
            }
            disabled={isDisabled}
            size="icon-sm"
            variant="brand"
          />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} />
        {selectedStatus || authorSelected ? (
          <span
            aria-hidden="true"
            className="ring-background absolute -top-0.75 -right-0.75 size-1.5 rounded-full ring-2"
            style={
              selectedStatus?.color
                ? { backgroundColor: selectedStatus.color }
                : undefined
            }
          />
        ) : null}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-72">
        <div className="space-y-3 p-3">
          {showAuthor && state.authorPicker ? (
            <section aria-label="Comment as customer" className="space-y-1.5">
              <p className="text-muted-foreground text-[11px] font-medium">
                Comment as customer
              </p>
              {state.authorPicker}
            </section>
          ) : null}
          {showAuthor && showStatus ? <Separator /> : null}
          {showStatus ? (
            <section
              aria-label={meta.statusUpdateLabel}
              className="space-y-1.5"
            >
              <p className="text-muted-foreground text-[11px] font-medium">
                {meta.statusUpdateLabel}
              </p>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <StatusField
                    currentStatusId={statusUpdateId}
                    disabled={authorSelected || isDisabled}
                    onValueChange={(status) =>
                      actions.onStatusUpdateIdChange(status?.id ?? null)
                    }
                    placeholder="Select status..."
                    statuses={state.statusOptions}
                  />
                </div>
                {statusSelected ? (
                  <Button
                    aria-label="Remove status update"
                    disabled={isDisabled}
                    onClick={() => actions.onStatusUpdateIdChange(null)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} />
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
