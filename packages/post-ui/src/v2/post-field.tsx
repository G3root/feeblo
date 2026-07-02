import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import { Button } from "@feeblo/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@feeblo/ui/combobox";
import { cn } from "@feeblo/ui/utils";
import {
  BOARD_LANE_COLOR_MAP,
  BoardIconMap,
  type BoardPostStatus,
  getBoardStatusLabel,
} from "@feeblo/web-shared/board/constants";
import { DashedLine02Icon } from "@hugeicons/core-free-icons";
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
}: {
  currentStatusId: string;
  statuses: Pick<TPostStatus, "id" | "type">[];
  onValueChange: (status: Pick<TPostStatus, "id" | "type"> | null) => void;
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
      <ComboboxTrigger
        render={
          <Button size="sm" variant="ghost">
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
          </Button>
        }
      />
      <ComboboxContent className="w-full">
        <ComboboxInput placeholder="Search" showTrigger={false} />
        <ComboboxEmpty>No items; found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <HugeiconsIcon
                className={cn(
                  "size-4",
                  BOARD_LANE_COLOR_MAP[item.type as BoardPostStatus]
                )}
                icon={BoardIconMap[item.type as BoardPostStatus]}
                strokeWidth={2}
              />{" "}
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

type PostBoardSelectProps = {
  boards: { id: string; name: string }[];
  currentBoardId: string;
  onValueChange: (boardId: string | null) => void;
};

export function PostBoardSelect({
  boards,
  currentBoardId,
  onValueChange,
}: PostBoardSelectProps) {
  const currentBoard = boards.find((b) => b.id === currentBoardId);
  const items = boards.map((board) => ({
    value: board.id,
    label: board.name,
  }));

  return (
    <Combobox
      items={items}
      onValueChange={(board) => onValueChange(board?.value ?? null)}
      value={
        currentBoard
          ? { value: currentBoard.id, label: currentBoard.name }
          : null
      }
    >
      <ComboboxTrigger
        render={
          <Button className="w-full justify-between" size="sm" variant="ghost">
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
          </Button>
        }
      />
      <ComboboxContent className="w-full">
        <ComboboxInput placeholder="Search boards" showTrigger={false} />
        <ComboboxEmpty>No boards found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              <HugeiconsIcon
                className="size-4 text-primary-blue"
                icon={DashedLine02Icon}
                strokeWidth={2}
              />{" "}
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
