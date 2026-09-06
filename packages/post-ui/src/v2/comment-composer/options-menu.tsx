import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { Separator } from "@feeblo/ui/separator";
import { Cancel01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import {
  NewUserDialog,
  NewUserFooter,
} from "../contact-combobox/new-user-dialog";
import { StatusField } from "../post-field";
import { useCommentComposer, useCommentComposerIsDisabled } from "./context";
import { useCommentComposerState } from "./store";

/**
 * The "more options" popover next to the comment submit button. Two mutually
 * exclusive sections — status update first, commenting as a customer second.
 * Picking one disables the other; each clears through its own dismiss
 * control, which is how you switch between them.
 */
export function CommentOptionsMenu() {
  const { actions, meta, state } = useCommentComposer();
  const statusUpdateId = useCommentComposerState(
    (context) => context.statusUpdateId
  );
  const isDisabled = useCommentComposerIsDisabled();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
  const canCreateAuthor = actions.onAuthorCreate !== undefined;

  return (
    <>
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
          <div className="min-w-0 space-y-3 overflow-x-clip p-3">
            {showStatus ? (
              <section
                aria-label={meta.statusUpdateLabel}
                className="min-w-0 space-y-1.5"
              >
                <p className="text-muted-foreground text-[11px] font-medium">
                  {meta.statusUpdateLabel}
                </p>
                <div className="flex min-w-0 items-center gap-1">
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
            {showAuthor && showStatus ? <Separator /> : null}
            {showAuthor && state.authorPicker ? (
              <section
                aria-label="Comment as customer"
                className="min-w-0 space-y-1.5"
              >
                <p className="text-muted-foreground text-[11px] font-medium">
                  Comment as customer
                </p>
                {state.authorPicker}
                {canCreateAuthor ? (
                  <NewUserFooter
                    disabled={statusSelected || isDisabled}
                    onNewUser={() => setIsCreateOpen(true)}
                  >
                    Add new author
                  </NewUserFooter>
                ) : null}
              </section>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
      {canCreateAuthor ? (
        <NewUserDialog
          onOpenChange={setIsCreateOpen}
          onSubmit={async (values) => {
            await actions.onAuthorCreate?.(values);
          }}
          open={isCreateOpen}
          submitLabel="Add author"
        />
      ) : null}
    </>
  );
}
