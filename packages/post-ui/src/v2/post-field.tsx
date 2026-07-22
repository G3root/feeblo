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
  getBoardStatusLabel,
} from "@feeblo/web-shared/board/constants";
import { DashedLine02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="w-14 shrink-0 text-muted-foreground text-sm">
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
}: {
  currentStatusId: string;
  statuses: Pick<TPostStatus, "id" | "type">[];
  onValueChange: (status: Pick<TPostStatus, "id" | "type"> | null) => void;
  disabled?: boolean;
}) {
  const items = statuses.map((postStatus) => ({
    label: getBoardStatusLabel(postStatus.type),
    type: postStatus.type,
    value: postStatus.id,
  }));
  const currentStatus = statuses.find(
    (postStatus) => postStatus.id === currentStatusId
  );
  const defaultValue = {
    value: currentStatusId,
    label: currentStatus ? getBoardStatusLabel(currentStatus.type) : "",
    type: currentStatus?.type ?? "PLANNED",
  };

  return (
    <Combobox
      defaultValue={defaultValue}
      disabled={disabled}
      items={items}
      key={currentStatusId}
      onValueChange={(value) =>
        onValueChange(
          value
            ? {
                id: value.value,
                type: value.type as BoardPostStatus,
              }
            : null
        )
      }
    >
      <ComboboxTrigger render={<SelectButton size="sm" />}>
        <ComboboxValue>
          {(value) => (
            <span className="flex items-center gap-2">
              {value ? (
                <>
                  <HugeiconsIcon
                    className={cn(
                      "size-4",
                      BOARD_LANE_COLOR_MAP[value.type as BoardPostStatus]
                    )}
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
      <ComboboxPopup aria-label="Select status" className="w-full">
        <div className="border-b p-2">
          <ComboboxInput
            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
            placeholder="Search statuses..."
            showTrigger={false}
            startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
          />
        </div>
        <ComboboxEmpty>No statuses found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <HugeiconsIcon
                  className={cn(
                    "size-4",
                    BOARD_LANE_COLOR_MAP[item.type as BoardPostStatus]
                  )}
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
      <ComboboxTrigger
        render={<SelectButton className="w-full" size="sm" />}
      >
        <ComboboxValue placeholder="Select board">
          {(value) => (
            <span className="flex items-center gap-2">
              {value ? (
                <>
                  <HugeiconsIcon
                    className="size-4 text-primary-blue"
                    icon={DashedLine02Icon}
                    strokeWidth={2}
                  />
                  {value.label}
                </>
              ) : null}
            </span>
          )}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Select board" className="w-full">
        <div className="border-b p-2">
          <ComboboxInput
            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
            placeholder="Search boards..."
            showTrigger={false}
            startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
          />
        </div>
        <ComboboxEmpty>No boards found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <HugeiconsIcon
                  className="size-4 text-primary-blue"
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
