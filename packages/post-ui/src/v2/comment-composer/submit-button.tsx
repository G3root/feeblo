import { Button } from "@feeblo/ui/button";
import { Group, GroupSeparator } from "@feeblo/ui/group";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { MoreVerticalIcon, Close } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentComposer, useCommentComposerIsDisabled } from "./context";
import { useCommentComposerState } from "./store";

export function SubmitButton() {
  const { actions, meta, state } = useCommentComposer();
  const isPrivate = useCommentComposerState((context) => context.isPrivate);
  const isDisabled = useCommentComposerIsDisabled();

  const hasStatusOptions = state.statusOptions.length > 0;

  return (
    <Group>
      <Button
        disabled={isDisabled}
        size="sm"
        type={actions.onSubmit ? "button" : "submit"}
        // variant={isPrivate ? "default" : "outline"}
        {...(actions?.onSubmit
          ? {
              onClick: actions.onSubmit,
            }
          : {})}
      >
        {meta.submitLabel ??
          (isPrivate
            ? `Comment ${meta.privateLabel}`
            : `Comment ${meta.publicLabel}`)}
      </Button>
      {hasStatusOptions ? (
        <>
          <GroupSeparator className="bg-primary/72" />
          <StatusUpdateMenu />
        </>
      ) : null}
    </Group>
  );
}

function StatusUpdateMenu() {
  const { actions, meta, state } = useCommentComposer();
  const statusUpdateId = useCommentComposerState(
    (context) => context.statusUpdateId
  );
  const isDisabled = useCommentComposerIsDisabled();

  const selectedStatus =
    statusUpdateId === null
      ? null
      : (state.statusOptions.find((option) => option.id === statusUpdateId) ??
        null);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={
              selectedStatus
                ? `Status update: ${selectedStatus.label}`
                : "Comment options"
            }
            disabled={isDisabled}
            size="icon-sm"
          />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} />
        {selectedStatus ? (
          <span
            aria-hidden="true"
            className="ring-background absolute -top-0.75 -right-0.75 size-1.5 rounded-full ring-2"
            style={
              selectedStatus.color
                ? { backgroundColor: selectedStatus.color }
                : undefined
            }
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" className="w-56">
        <MenuRadioGroup
          // SAFETY: `null` maps to "nothing selected" for Base UI radio groups.
          value={statusUpdateId ?? undefined}
          onValueChange={(value) =>
            // SAFETY: values come from the `option.id` strings below.
            actions.onStatusUpdateIdChange(value as string | null)
          }
        >
          <MenuGroupLabel>{meta.statusUpdateLabel}</MenuGroupLabel>
          {state.statusOptions.map((option) => (
            <MenuRadioItem
              key={option.id}
              // Base UI's MenuRadioItem defaults to `closeOnClick: false`,
              // which would leave the menu's modal inert overlay in place and
              // block the “Comment Public” submit button next to it.
              closeOnClick
              value={option.id}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={
                    option.color
                      ? { backgroundColor: option.color }
                      : undefined
                  }
                />
                {option.label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {selectedStatus ? (
          <>
            <MenuSeparator />
            <MenuItem
              closeOnClick
              onClick={() => actions.onStatusUpdateIdChange(null)}
            >
              <HugeiconsIcon icon={Close} /> Remove status update
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
