import { RoadmapColumnId } from "@feeblo/id";
import { withForm } from "@feeblo/ui/hooks/form";
import { Separator } from "@feeblo/ui/separator";
import { getBoardStatusLabel } from "@feeblo/web-shared/board/constants";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { postStatusCollection } from "~/lib/collections";

import { roadmapFormOpts } from "../shared-form";
import {
  RoadmapColumnItem,
  RoadmapAddColumnButton,
} from "./roadmap-column-fields";
import { RoadmapVisibilityField } from "./roadmap-visibility-field";

export const RoadmapFields = withForm({
  ...roadmapFormOpts,
  render: ({ form }) => {
    return (
      <>
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>
        <form.AppField name="description">
          {(field) => <field.TextareaField label="Description" />}
        </form.AppField>
        <RoadmapVisibilityField form={form} />
        <RoadmapColumnsSection form={form} />
      </>
    );
  },
});

const RoadmapColumnsSection = withForm({
  ...roadmapFormOpts,
  render: function RoadmapColumnsSectionRender({ form }) {
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
    const openItemIds = new Set(openItems);

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
                      open={openItemIds.has(column.id)}
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
