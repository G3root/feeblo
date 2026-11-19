import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  ComboboxValue,
} from "@feeblo/ui/combobox";
import { TablerIcon } from "@feeblo/ui/icon-picker";
import { SelectButton } from "@feeblo/ui/select";
import { cn } from "@feeblo/ui/utils";
import {
  BOARD_LANE_COLOR_MAP,
  type BoardPostStatus,
} from "@feeblo/web-shared/board/constants";
import { boardIconName } from "@feeblo/web-shared/icons/defaults";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "./paraglide/messages.js";
import { formatPostStatus } from "./post-status";
import { PostStatusIcon } from "./post-status-icon";

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="text-muted-foreground w-14 shrink-0 text-sm">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type PostStatusChoice = Pick<TPostStatus, "id" | "label" | "type"> &
  /**
   * Optional because a caller that builds its own option list may not carry
   * the icon; the status then renders its type's default.
   */
  Partial<Pick<TPostStatus, "icon">>;

export function StatusField({
  currentStatusId,
  statuses,
  onValueChange,
  disabled = false,
  placeholder = m.safe_jolly_shell(),
  showTrigger = true,
  triggerClassName = "w-full",
}: {
  /** Null renders the placeholder: the field supports "nothing selected". */
  currentStatusId: string | null;
  statuses: readonly PostStatusChoice[];
  onValueChange: (status: PostStatusChoice | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Hide the chevron for a row that renders the control as plain text. */
  showTrigger?: boolean;
  /** The trigger is full-width in forms and content-sized in the details list. */
  triggerClassName?: string;
}) {
  const items = statuses.map((postStatus) => ({
    icon: postStatus.icon,
    label: postStatus.label || formatPostStatus(postStatus.type),
    type: postStatus.type,
    value: postStatus.id,
  }));

  const currentStatus =
    currentStatusId === null
      ? undefined
      : statuses.find((postStatus) => postStatus.id === currentStatusId);

  const defaultValue = currentStatus
    ? {
        value: currentStatus.id,
        icon: currentStatus.icon,
        label: currentStatus.label || formatPostStatus(currentStatus.type),
        type: currentStatus.type,
      }
    : null;

  return (
    <Combobox
      defaultValue={defaultValue}
      disabled={disabled}
      items={items}
      key={currentStatusId ?? "none"}
      onValueChange={(value) =>
        onValueChange(
          value
            ? {
                id: value.value,
                icon: value.icon,
                label: value.label,
                // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                type: value.type as BoardPostStatus,
              }
            : null
        )
      }
    >
      <ComboboxTrigger
        render={
          <SelectButton
            className={triggerClassName}
            showTrigger={showTrigger}
            size="sm"
          />
        }
      >
        <ComboboxValue placeholder={placeholder}>
          {(value) => {
            if (!value) {
              return null;
            }

            const current = statuses.find(
              (status) => status.id === value.value
            );

            // One row decides every part of the trigger: an icon change and a
            // section change that keep the id must not disagree.
            // SAFETY: The items are built from TPostStatus rows, so both
            // branches are a status type.
            const type = (current?.type ?? value.type) as BoardPostStatus;
            const icon = current === undefined ? value.icon : current.icon;

            const label =
              current === undefined
                ? value.label
                : current.label || formatPostStatus(current.type);

            return (
              <span className="flex items-center gap-2">
                <span className={cn(BOARD_LANE_COLOR_MAP[type])}>
                  <PostStatusIcon icon={icon} type={type} />
                </span>
                {label}
              </span>
            );
          }}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup aria-label={m.safe_jolly_shell()} className="w-full">
        <div className="border-b p-2">
          <ComboboxInput
            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
            placeholder={m.seemly_tasty_nuthatch()}
            showTrigger={false}
            startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
          />
        </div>
        <ComboboxEmpty>{m.key_super_antelope()}</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className={cn(
                    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                    BOARD_LANE_COLOR_MAP[item.type as BoardPostStatus]
                  )}
                >
                  <PostStatusIcon
                    icon={item.icon}
                    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                    type={item.type as BoardPostStatus}
                  />
                </span>
                {item.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export type PostBoardSelectProps = {
  boards: { icon?: string | null; id: string; name: string }[];
  currentBoardId: string;
  onValueChange: (boardId: string | null) => void;
  disabled?: boolean;
  showTrigger?: boolean;
  triggerClassName?: string;
};

export function PostBoardSelect({
  boards,
  currentBoardId,
  onValueChange,
  disabled = false,
  showTrigger = true,
  triggerClassName = "w-full",
}: PostBoardSelectProps) {
  const currentBoard = boards.find((b) => b.id === currentBoardId);

  const items = boards.map((board) => ({
    icon: board.icon,
    label: board.name,
    value: board.id,
  }));

  return (
    <Combobox
      disabled={disabled}
      items={items}
      onValueChange={(board) => onValueChange(board?.value ?? null)}
      value={
        currentBoard
          ? {
              icon: currentBoard.icon,
              label: currentBoard.name,
              value: currentBoard.id,
            }
          : null
      }
    >
      <ComboboxTrigger
        render={
          <SelectButton
            className={triggerClassName}
            showTrigger={showTrigger}
            size="sm"
          />
        }
      >
        <ComboboxValue placeholder={m.upper_tangy_monkey()}>
          {(value) => (
            <span className="flex items-center gap-2">
              {value ? (
                <>
                  <TablerIcon name={boardIconName(value.icon)} />
                  {value.label}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {m.upper_tangy_monkey()}
                </span>
              )}
            </span>
          )}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup aria-label={m.upper_tangy_monkey()} className="w-full">
        <div className="border-b p-2">
          <ComboboxInput
            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
            placeholder={m.aware_nimble_robin()}
            showTrigger={false}
            startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
          />
        </div>
        <ComboboxEmpty>{m.basic_alert_boar()}</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <TablerIcon name={boardIconName(item.icon)} />
                {item.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
