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
import { SelectButton } from "@feeblo/ui/select";
import { cn } from "@feeblo/ui/utils";
import {
  BOARD_LANE_COLOR_MAP,
  BoardIconMap,
  type BoardPostStatus,
  formatPostStatus,
} from "@feeblo/web-shared/board/constants";
import { DashedLine02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../paraglide/messages.js";

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

export function StatusField({
  currentStatusId,
  statuses,
  onValueChange,
  disabled = false,
  placeholder = m.safe_jolly_shell(),
}: {
  /** Null renders the placeholder: the field supports "nothing selected". */
  currentStatusId: string | null;
  statuses: readonly Pick<TPostStatus, "id" | "label" | "type">[];
  onValueChange: (
    status: Pick<TPostStatus, "id" | "label" | "type"> | null
  ) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const items = statuses.map((postStatus) => ({
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
                label: value.label,
                // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                type: value.type as BoardPostStatus,
              }
            : null
        )
      }
    >
      <ComboboxTrigger render={<SelectButton size="sm" />}>
        <ComboboxValue placeholder={placeholder}>
          {(value) => (
            <span className="flex items-center gap-2">
              {value ? (
                <>
                  <HugeiconsIcon
                    className={cn(
                      "size-4",
                      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                      BOARD_LANE_COLOR_MAP[value.type as BoardPostStatus]
                    )}
                    // SAFETY: The upstream contract guarantees this value here.
                    icon={BoardIconMap[value.type as BoardPostStatus]}
                    strokeWidth={2}
                  />
                  {value.label}
                </>
              ) : null}
            </span>
          )}
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
                <HugeiconsIcon
                  className={cn(
                    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                    // SAFETY: The upstream contract guarantees this value here.
                    "size-4",
                    // SAFETY: The upstream contract guarantees this value here.
                    BOARD_LANE_COLOR_MAP[item.type as BoardPostStatus]
                  )}
                  // SAFETY: The upstream contract guarantees this value here.
                  icon={BoardIconMap[item.type as BoardPostStatus]}
                  strokeWidth={2}
                />
                {item.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

type PostBoardSelectProps = {
  boards: { id: string; name: string }[];
  currentBoardId: string;
  onValueChange: (boardId: string | null) => void;
  disabled?: boolean;
};

export function PostBoardSelect({
  boards,
  currentBoardId,
  onValueChange,
  disabled = false,
}: PostBoardSelectProps) {
  const currentBoard = boards.find((b) => b.id === currentBoardId);
  const items = boards.map((board) => ({
    value: board.id,
    label: board.name,
  }));

  return (
    <Combobox
      disabled={disabled}
      items={items}
      onValueChange={(board) => onValueChange(board?.value ?? null)}
      value={
        currentBoard
          ? { value: currentBoard.id, label: currentBoard.name }
          : null
      }
    >
      <ComboboxTrigger render={<SelectButton className="w-full" size="sm" />}>
        <ComboboxValue placeholder={m.upper_tangy_monkey()}>
          {(value) => (
            <span className="flex items-center gap-2">
              {value ? (
                <>
                  <HugeiconsIcon
                    className="text-primary-blue size-4"
                    icon={DashedLine02Icon}
                    strokeWidth={2}
                  />
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
                <HugeiconsIcon
                  className="text-primary-blue size-4"
                  icon={DashedLine02Icon}
                  strokeWidth={2}
                />
                {item.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
