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
import {
  BOARD_LANE_COLOR_MAP,
  BOARD_LANE_COLUMN_MAP,
  BoardIconMap,
  type BoardPostStatus,
} from "~/features/board/constants";
import { cn } from "~/lib/utils";

export function PropertyRow({
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

const items = Object.keys(BOARD_LANE_COLUMN_MAP).map((status) => ({
  value: status,
  label: BOARD_LANE_COLUMN_MAP[status as BoardPostStatus],
}));

export function StatusSelect({
  currentStatus,
  onValueChange,
}: {
  currentStatus: BoardPostStatus;
  onValueChange: (status: BoardPostStatus | null) => void;
}) {
  const defaultValue = {
    value: currentStatus,
    label: BOARD_LANE_COLUMN_MAP[currentStatus],
  };

  return (
    <Combobox
      defaultValue={defaultValue}
      items={items}
      onValueChange={(value) => onValueChange(value?.value ?? null)}
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
                          BOARD_LANE_COLOR_MAP[value.value as BoardPostStatus]
                        )}
                        icon={BoardIconMap[value.value as BoardPostStatus]}
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
                  BOARD_LANE_COLOR_MAP[item.value as BoardPostStatus]
                )}
                icon={BoardIconMap[item.value as BoardPostStatus]}
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
