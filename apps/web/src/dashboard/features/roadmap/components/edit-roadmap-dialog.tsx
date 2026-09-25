import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { roadmapCollection, roadmapColumnCollection } from "~/lib/collections";

import { useEditRoadmapDialogContext } from "../dialog-stores";
import { type RoadmapFormValues, roadmapFormOpts } from "../shared-form";
import { RoadmapFields } from "./roadmap-fields";

export function EditRoadmapDialog() {
  const store = useEditRoadmapDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Edit Roadmap</SheetTitle>
          <SheetDescription>Update the roadmap details.</SheetDescription>
        </SheetHeader>
        <EditRoadmapForm />
      </SheetPopup>
    </Sheet>
  );
}

function EditRoadmapForm() {
  const organizationId = useOrganizationId();
  const store = useEditRoadmapDialogContext();
  const data = useSelector(store, (state) => state.context.data);

  const roadmapQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            eq(roadmap.id, data.roadmapId)
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          name: roadmap.name,
          slug: roadmap.slug,
          visibility: roadmap.visibility,
        }))
        .findOne(),
  });

  const columnsQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ column: roadmapColumnCollection })
        .where(({ column }) => eq(column.roadmapId, data.roadmapId))
        .orderBy(({ column }) => column.position, "asc"),
  });

  if (roadmapQuery.isLoading || columnsQuery.isLoading) {
    return null;
  }

  if (!(roadmapQuery.data && columnsQuery.data)) {
    throw new Error("not found");
  }

  return (
    <EditRoadmapFormFields
      columns={columnsQuery.data}
      roadmap={roadmapQuery.data}
      roadmapId={data.roadmapId}
    />
  );
}

function EditRoadmapFormFields({
  columns,
  roadmap,
  roadmapId,
}: {
  columns: Array<{
    id: string;
    name: string;
    position: number;
    statusId: string;
  }>;
  roadmap: {
    description: string | null;
    name: string;
    slug: string;
    visibility: "public" | "private";
  };
  roadmapId: string;
}) {
  const organizationId = useOrganizationId();
  const store = useEditRoadmapDialogContext();

  const defaultValues: RoadmapFormValues = {
    ...roadmap,
    columns: columns.map((column) => ({
      id: column.id,
      name: column.name,
      statusId: column.statusId,
    })),
  };

  const form = useAppForm({
    ...roadmapFormOpts,
    defaultValues,
    onSubmit: async ({ value }) => {
      const oldSlug = roadmap.slug;
      const newSlugifiedValue = slugify(value.name);
      try {
        const tx = roadmapCollection.update(roadmapId, (draft) => {
          draft.name = value.name;
          draft.slug = newSlugifiedValue;
          draft.description = value.description ?? null;
          draft.visibility = value.visibility;
          draft.updatedAt = new Date();
        });

        if (newSlugifiedValue !== oldSlug) {
          window.history.replaceState(
            null,
            "",
            `/${organizationId}/roadmap/${newSlugifiedValue}`
          );
        }

        await tx.isPersisted.promise;

        const persistedById = new Map(
          columns.map((column) => [column.id, column])
        );
        const nextIds = new Set(value.columns.map((column) => column.id));

        const mutations: Promise<unknown>[] = [];

        for (const column of columns) {
          if (!nextIds.has(column.id)) {
            mutations.push(
              roadmapColumnCollection.delete(column.id).isPersisted.promise
            );
          }
        }

        const now = new Date();

        for (const [index, column] of value.columns.entries()) {
          const persisted = persistedById.get(column.id);

          if (!persisted) {
            mutations.push(
              roadmapColumnCollection.insert({
                id: column.id,
                roadmapId,
                name: column.name,
                position: index,
                statusId: column.statusId,
                createdAt: now,
                updatedAt: now,
              }).isPersisted.promise
            );
            continue;
          }

          if (
            persisted.name !== column.name ||
            persisted.statusId !== column.statusId ||
            persisted.position !== index
          ) {
            mutations.push(
              roadmapColumnCollection.update(column.id, (draft) => {
                draft.name = column.name;
                draft.statusId = column.statusId;
                draft.position = index;
                draft.updatedAt = now;
              }).isPersisted.promise
            );
          }
        }

        await Promise.all(mutations);

        store.send({ type: "toggle" });
        toastManager.add({
          title: "Roadmap updated successfully",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to update roadmap",
          type: "error",
        });

        if (newSlugifiedValue !== oldSlug) {
          window.history.replaceState(
            null,
            "",
            `/${organizationId}/roadmap/${oldSlug}`
          );
        }
      }
    },
  });

  return (
    <form
      className="contents"
      data-slot="form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppForm>
        <SheetPanel className="grid gap-4">
          <RoadmapFields form={form} />
        </SheetPanel>
        <SheetFooter>
          <form.SubscribeButton label="Save" />
        </SheetFooter>
      </form.AppForm>
    </form>
  );
}
