import { RoadmapColumnId } from "@feeblo/id";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@feeblo/ui/accordion";
import { Button } from "@feeblo/ui/button";
import { Field, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { Separator } from "@feeblo/ui/separator";
import { getBoardStatusLabel } from "@feeblo/web-shared/board/constants";
import { Delete02Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { postStatusCollection } from "~/lib/collections";
import { roadmapFormOpts } from "../shared-form";

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
        <RoadmapColumnsField form={form} />
      </>
    );
  },
});

const RoadmapColumnsField = withForm({
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
        <div className="font-medium text-sm">Columns</div>
        <form.Field mode="array" name="columns">
          {(field) => {
            const columns = field.state.value;
            const usedStatusIds = new Set(
              columns.map((column) => column.statusId)
            );
            const nextStatus = statusOptions.find(
              (status) => !usedStatusIds.has(status.id)
            );

            const handleAddColumn = async () => {
              const id = await RoadmapColumnId.unsafeGenerate();
              field.pushValue({
                id,
                name: nextStatus ? getBoardStatusLabel(nextStatus.type) : "",
                statusId: nextStatus?.id ?? "",
              });
              setOpenItems((current) => [...current, id]);
            };

            return (
              <div className="grid gap-2">
                {columns.length > 0 ? (
                  <Accordion
                    multiple
                    onValueChange={(value) => setOpenItems(value as string[])}
                    value={openItems}
                  >
                    {columns.map((column, index) => (
                      <AccordionItem key={column.id} value={column.id}>
                        <div className="flex items-center gap-1">
                          <AccordionTrigger className="py-3">
                            <span className="truncate">
                              {column.name || "Untitled column"}
                            </span>
                          </AccordionTrigger>
                          <Button
                            aria-label="Remove column"
                            onClick={() => {
                              field.removeValue(index);
                              setOpenItems((current) =>
                                current.filter((item) => item !== column.id)
                              );
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon icon={Delete02Icon} />
                          </Button>
                        </div>
                        <AccordionPanel className="grid gap-3">
                          <form.AppField
                            children={(subField) => (
                              <subField.TextField label="Name" />
                            )}
                            name={`columns[${index}].name`}
                          />
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
                        </AccordionPanel>
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No columns yet. Add a column for each stage of this roadmap.
                  </p>
                )}
                <div>
                  <Button
                    disabled={!nextStatus}
                    onClick={handleAddColumn}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <HugeiconsIcon icon={Plus} />
                    Add new column
                  </Button>
                </div>
              </div>
            );
          }}
        </form.Field>
      </div>
    );
  },
});
