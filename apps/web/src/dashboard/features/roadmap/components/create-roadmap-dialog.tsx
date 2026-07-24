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
import { useSelector } from "@xstate/store-react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { roadmapCollection } from "~/lib/collections";
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
  const form = useAppForm({
    ...roadmapFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const tx = roadmapCollection.insert({
          id: await RoadmapId.unsafeGenerate(),
          createdAt: new Date(),
          updatedAt: new Date(),
          name: value.name,
          slug: slugify(value.name),
          description: value.description ?? null,
          isPrimary: false,
          mode: "status",
          visibility: value.visibility,
          filter: emptyFilter,
          organizationId,
        });

        await tx.isPersisted.promise;
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
      <SheetPanel className="grid gap-4">
        <RoadmapFields form={form} />
      </SheetPanel>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label="Save" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
