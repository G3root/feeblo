import { RoadmapId } from "@feeblo/id";
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
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { roadmapCollection, roadmapColumnCollection } from "~/lib/collections";

import { useCreateRoadmapDialogContext } from "../dialog-stores";
import { roadmapFormOpts } from "../shared-form";
import { RoadmapFields } from "./roadmap-fields";

const emptyFilter = {
  version: 1 as const,
  operator: "and" as const,
  conditions: [],
};

export function CreateRoadmapDialog() {
  const store = useCreateRoadmapDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create Roadmap</SheetTitle>
          <SheetDescription>
            Create a new roadmap to organize your feedback.
          </SheetDescription>
        </SheetHeader>
        <CreateRoadmapForm />
      </SheetPopup>
    </Sheet>
  );
}

function CreateRoadmapForm() {
  const organizationId = useOrganizationId();
  const store = useCreateRoadmapDialogContext();

  const { data: roadmaps, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) => eq(roadmap.organizationId, organizationId)),
    [organizationId]
  );

  const isFirstRoadmap =
    !isLoading && roadmaps !== undefined && roadmaps.length === 0;

  const form = useAppForm({
    ...roadmapFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const now = new Date();
        const roadmapId = await RoadmapId.unsafeGenerate();
        const tx = roadmapCollection.insert({
          id: roadmapId,
          createdAt: now,
          updatedAt: now,
          name: value.name,
          slug: slugify(value.name),
          description: value.description ?? null,
          isPrimary: isFirstRoadmap,
          mode: "status",
          visibility: value.visibility,
          filter: emptyFilter,
          organizationId,
        });

        await tx.isPersisted.promise;

        await Promise.all(
          value.columns.map(async (column, index) => {
            const columnTx = roadmapColumnCollection.insert({
              id: column.id,
              roadmapId,
              name: column.name,
              position: index,
              statusId: column.statusId,
              createdAt: now,
              updatedAt: now,
            });

            await columnTx.isPersisted.promise;
          })
        );

        store.send({ type: "toggle" });
        toastManager.add({
          title: "Roadmap created successfully",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to create roadmap",
          type: "error",
        });
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
