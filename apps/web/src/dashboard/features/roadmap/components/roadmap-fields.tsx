import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import { RoadmapColumnId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { Field, FieldLabel } from "@feeblo/ui/field";
import { Frame, FrameHeader, FramePanel } from "@feeblo/ui/frame";
import { useTypedAppFormContext, withForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { Separator } from "@feeblo/ui/separator";
import { getBoardStatusLabel } from "@feeblo/web-shared/board/constants";
import {
  ChevronDownIcon,
  Delete02Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { postStatusCollection } from "~/lib/collections";

import { roadmapFormOpts } from "../shared-form";
import { RoadmapVisibilityField } from "./roadmap-visibility-field";

export const RoadmapFields = withForm({
  ...roadmapFormOpts,
  render: ({ form }) => {
    return (
      <>
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <form.AppField
          children={(field) => <field.TextareaField label="Description" />}
          name="description"
        />
        <RoadmapVisibilityField form={form} />
        <RoadmapColumnsSection form={form} />
      </>
    );
  },
});

const RoadmapColumnsSection = withForm({
  ...roadmapFormOpts,
  render: ({ form }) => {
    const organizationId = useOrganizationId();
    const [openItems, setOpenItems] = useState<string[]>([]);

    const { data: statuses } = useLiveQuery(
      (q) =>
        q
          .from({ postStatus: postStatusCollection })
          .where(({ postStatus }) =>
            eq(postStatus.organizationId, organizationId)
          )
          .orderBy(({ postStatus }) => postStatus.orderIndex, "asc"),
      [organizationId]
    );

    const statusOptions = statuses ?? [];

    return (
      <div className="grid gap-3">
        <Separator />
        <div className="text-sm font-medium">Columns</div>
        <form.Field mode="array" name="columns">
          {(field) => {
            const columns = field.state.value;

            return (
              <div className="grid gap-2">
                {columns.length > 0 ? (
                  columns.map((column, index) => (
                    <RoadmapColumnItem
                      index={index}
                      key={column.id}
                      onOpenChange={(open) =>
                        setOpenItems((current) =>
                          open
                            ? [...current, column.id]
                            : current.filter((item) => item !== column.id)
                        )
                      }
                      onRemoveColumn={() => {
                        form.removeFieldValue("columns", index);
                        setOpenItems((current) =>
                          current.filter((item) => item !== column.id)
                        );
                      }}
                      open={openItems.includes(column.id)}
                      statusOptions={statusOptions}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No columns yet. Add a column for each stage of this roadmap.
                  </p>
                )}
                <RoadmapAddColumnButton
                  onAddColumn={async (nextStatus) => {
                    const id = await RoadmapColumnId.unsafeGenerate();
                    form.pushFieldValue("columns", {
                      id,
                      name: nextStatus
                        ? getBoardStatusLabel(nextStatus.type)
                        : "",
                      statusId: nextStatus?.id ?? "",
                    });
                    setOpenItems((current) => [...current, id]);
                  }}
                  statusOptions={statusOptions}
                />
              </div>
            );
          }}
        </form.Field>
      </div>
    );
  },
});

interface RoadmapColumnItemProps {
  index: number;
  onOpenChange: (open: boolean) => void;
  onRemoveColumn: () => void;
  open: boolean;
  statusOptions: TPostStatus[];
}

function RoadmapColumnItem({
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
            <form.AppField
              children={(subField) => <subField.TextField label="Name" />}
              name={`columns[${index}].name`}
            />
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
                  <form.AppField
                    children={(subField) => (
                      <Field>
                        <FieldLabel>Status</FieldLabel>
                        <Select
                          onValueChange={(value) =>
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
                                  ? getBoardStatusLabel(status.type)
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
                                {getBoardStatusLabel(status.type)}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </Field>
                    )}
                    name={`columns[${index}].statusId`}
                  />
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

function RoadmapAddColumnButton({
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
