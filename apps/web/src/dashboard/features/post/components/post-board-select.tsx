import { DashedLine02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "~/components/ui/combobox";

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
