import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import {
  selectTriggerIconClassName,
  selectTriggerVariants,
} from "@feeblo/ui/select";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import {
  ContactCombobox,
  describeContactSelection,
  type ContactComboboxSelection,
  type ContactSearchFn,
} from "../contact-combobox/contact-combobox";
import {
  NewUserDialog,
  NewUserFooter,
  type NewUserValues,
} from "../contact-combobox/new-user-dialog";

/**
 * Trigger display for the picked author. A subset of
 * {@link ContactComboboxSelection}: dashboards show the post's stored
 * author (which has no contact identifiers), while create flows derive it
 * from the selection itself.
 */
export interface AuthorPickerDisplay {
  readonly avatarUrl?: string | null;
  readonly email?: string | null;
  readonly name?: string | null;
}

export interface AuthorPickerProps {
  /** Renders the author as static text: no popover, no dialog. */
  disabled?: boolean;
  /**
   * Trigger display override. Defaults to the selection-derived
   * `{ avatarUrl, email, name }`; dashboards pass the post's stored author
   * here while the picker's search state stays unselected.
   */
  display?: AuthorPickerDisplay | null;
  /** Accessible name for the trigger and the search input. */
  label?: string;
  /**
   * Called with the picked subject (or `null` when the pick is cleared).
   * May be async: the popover closes once a non-null selection settles.
   * Consumers own error display; a rejection only keeps the popover open.
   */
  onSelect: (
    selection: ContactComboboxSelection | null
  ) => void | Promise<void>;
  organizationId: string;
  /** Trigger text when no author is displayed. */
  placeholder?: string;
  /**
   * Post-scoped search for API compatibility. Author picking ignores
   * voting state (`alreadyVoted` neither disables rows nor shows a badge):
   * voting history must not block attribution. Omit when no post exists
   * yet (create flows).
   */
  postId?: string;
  /** Replace the ContactSearch transport (stories/tests). */
  search?: ContactSearchFn;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Submit label of the new-user dialog. */
  submitLabel?: string;
  /** Picker selection; drives the combobox state (clear control, badges). */
  value: ContactComboboxSelection | null;
}

/**
 * Shared author picker: a trigger (avatar + name, or a placeholder action)
 * opening a searchable people picker (`ContactSearch`) with a "brand new
 * user" entry point backed by the shared name/email dialog. Used for both
 * reattributing an existing post (dashboard details) and staging the
 * author of a post being created — what happens with the selection is the
 * caller's `onSelect` (persisting vs. form state).
 */
export function AuthorPicker({
  disabled = false,
  display,
  label = "Select author",
  onSelect,
  organizationId,
  placeholder = "Select author",
  postId,
  search,
  searchPlaceholder = "Search users...",
  submitLabel = "Create & set author",
  value,
}: AuthorPickerProps) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const displayValue = display ?? value;
  // `describeContactSelection` takes the selection shape (no nulls);
  // normalize the trigger display, which also carries stored post authors.
  const displayName =
    displayValue === null || displayValue === undefined
      ? null
      : describeContactSelection({
          avatarUrl: displayValue.avatarUrl ?? undefined,
          email: displayValue.email ?? undefined,
          name: displayValue.name ?? undefined,
        });
  const displayAvatarUrl = displayValue?.avatarUrl ?? null;
  const displayNameAttr = displayValue?.name ?? null;

  const handleSelect = (selection: ContactComboboxSelection | null) => {
    void Promise.resolve()
      .then(() => onSelect(selection))
      .then(
        () => {
          // Clearing stays in the popover so another person can be picked
          // without reopening it.
          if (selection !== null) {
            setOpen(false);
          }
        },
        () => {
          // Consumers own error display; a rejection only keeps the
          // popover open for correction.
        }
      );
  };

  const handleCreateSubmit = async (values: NewUserValues): Promise<void> => {
    await onSelect({ email: values.email, name: values.name });
    setOpen(false);
  };

  if (disabled) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <UserAvatar image={displayAvatarUrl} name={displayNameAttr} size="sm" />
        <span className="truncate font-medium">
          {displayName ?? placeholder}
        </span>
      </span>
    );
  }

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        {/* NOTE: the render element is intentionally a plain button, not
            SelectButton: SelectButton wraps trigger children in its own
            truncating span and appends its own chevron, which nests and
            duplicates this content. The shared selectTriggerVariants keep
            the styling identical to the select buttons. */}
        <PopoverTrigger
          render={
            <button
              aria-label={displayName ? `${label}: ${displayName}` : label}
              className={cn(
                selectTriggerVariants({ size: "sm" }),
                "aria-expanded:bg-muted w-auto min-w-0"
              )}
              type="button"
            />
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {displayName ? (
              <>
                <UserAvatar
                  className="size-5"
                  image={displayAvatarUrl}
                  name={displayNameAttr}
                  size="sm"
                />
                <span className="truncate font-medium">{displayName}</span>
              </>
            ) : (
              <span className="text-muted-foreground truncate font-medium">
                {placeholder}
              </span>
            )}
          </span>
          <HugeiconsIcon
            aria-hidden="true"
            className={selectTriggerIconClassName}
            icon={UnfoldMoreIcon}
            strokeWidth={2}
          />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-60 p-1" initialFocus={false}>
          <ContactCombobox
            disableAlreadyVoted={false}
            label={label}
            onSelect={handleSelect}
            organizationId={organizationId}
            placeholder={searchPlaceholder}
            postId={postId}
            search={search}
            value={value}
          />
          <NewUserFooter onNewUser={() => setCreateOpen(true)}>
            Add a brand new user
          </NewUserFooter>
        </PopoverPopup>
      </Popover>

      <NewUserDialog
        onOpenChange={setCreateOpen}
        onSubmit={handleCreateSubmit}
        open={createOpen}
        submitLabel={submitLabel}
      />
    </>
  );
}
