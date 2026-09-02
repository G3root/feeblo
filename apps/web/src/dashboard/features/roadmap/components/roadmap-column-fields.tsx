import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import { Button } from "@feeblo/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { Field, FieldLabel } from "@feeblo/ui/field";
import { Frame, FrameHeader, FramePanel } from "@feeblo/ui/frame";
import { useTypedAppFormContext } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import {
  ChevronDownIcon,
  Delete02Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { roadmapFormOpts } from "../shared-form";

interface RoadmapColumnItemProps {
  index: number;
  onOpenChange: (open: boolean) => void;
  onRemoveColumn: () => void;
  open: boolean;
  statusOptions: TPostStatus[];
}

export function RoadmapColumnItem({
  index,
  open,
  onOpenChange,
  onRemoveColumn,
  statusOptions,
}: RoadmapColumnItemProps) {
  const form = useTypedAppFormContext(roadmapFormOpts);

  return (
    <Frame className="w-full">
      <Collapsible onOpenChange={onOpenChange} open={open}>
        <FrameHeader className="flex-row items-center justify-between px-2 py-2">
          <CollapsibleTrigger
            className="data-panel-open:[&_svg]:rotate-180"
            render={<Button variant="ghost" />}
          >
            <HugeiconsIcon
              className="size-4 transition-transform duration-200"
              icon={ChevronDownIcon}
            />
            <form.Subscribe
              selector={(state) => state.values.columns[index]?.name ?? ""}
            >
              {(name) => (
                <span className="truncate">{name || "Untitled column"}</span>
              )}
            </form.Subscribe>
          </CollapsibleTrigger>
          <Button
            aria-label="Remove column"
            onClick={onRemoveColumn}
            size="icon"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        </FrameHeader>
        <CollapsiblePanel>
          <FramePanel className="grid gap-3">
            <form.AppField name={`columns[${index}].name`}>
              {(subField) => <subField.TextField label="Name" />}
            </form.AppField>
            <form.Subscribe
              selector={(state) =>
                state.values.columns.map((column) => column.statusId).join(",")
              }
            >
              {(usedStatusKey) => {
                const usedStatusIds = new Set(
                  usedStatusKey ? usedStatusKey.split(",") : []
                );

                return (
                  <form.AppField name={`columns[${index}].statusId`}>
                    {(subField) => (
                      <Field>
                        <FieldLabel>Status</FieldLabel>
                        <Select
                          onValueChange={(value) =>
                            // SAFETY: The upstream contract guarantees a string here.
                            subField.handleChange(value as string)
                          }
                          value={subField.state.value}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(value: string) => {
                                const status = statusOptions.find(
                                  (option) => option.id === value
                                );
                                return status
                                  ? status.label ||
                                      formatPostStatus(status.type)
                                  : "Select a status";
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            {statusOptions.map((status) => (
                              <SelectItem
                                disabled={
                                  usedStatusIds.has(status.id) &&
                                  status.id !== subField.state.value
                                }
                                key={status.id}
                                value={status.id}
                              >
                                {status.label || formatPostStatus(status.type)}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </Field>
                    )}
                  </form.AppField>
                );
              }}
            </form.Subscribe>
          </FramePanel>
        </CollapsiblePanel>
      </Collapsible>
    </Frame>
  );
}
interface RoadmapAddColumnButtonProps {
  onAddColumn: (nextStatus: TPostStatus | undefined) => Promise<void>;
  statusOptions: TPostStatus[];
}

export function RoadmapAddColumnButton({
  onAddColumn,
  statusOptions,
}: RoadmapAddColumnButtonProps) {
  const form = useTypedAppFormContext(roadmapFormOpts);

  return (
    <form.Subscribe
      selector={(state) =>
        state.values.columns.map((column) => column.statusId).join(",")
      }
    >
      {(usedStatusKey) => {
        const usedStatusIds = new Set(
          usedStatusKey ? usedStatusKey.split(",") : []
        );
        const nextStatus = statusOptions.find(
          (status) => !usedStatusIds.has(status.id)
        );

        return (
          <div>
            <Button
              disabled={!nextStatus}
              onClick={() => {
                onAddColumn(nextStatus);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <HugeiconsIcon icon={Plus} />
              Add new column
            </Button>
          </div>
        );
      }}
    </form.Subscribe>
  );
}
