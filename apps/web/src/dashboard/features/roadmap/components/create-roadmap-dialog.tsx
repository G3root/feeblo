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
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { roadmapCollection } from "~/lib/collections";
import { useCreateRoadmapDialogContext } from "../dialog-stores";

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
        <CreateRoadmapForm onSuccess={() => store.send({ type: "toggle" })} />
      </SheetPopup>
    </Sheet>
  );
}

const emptyFilter = {
  version: 1 as const,
  operator: "and" as const,
  conditions: [],
};

function CreateRoadmapForm({ onSuccess }: { onSuccess: () => void }) {
  const organizationId = useOrganizationId();
  const form = useAppForm({
    defaultValues: {
      name: "",
      visibility: "public" as "public" | "private",
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1),
        visibility: z.enum(["public", "private"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = roadmapCollection.insert({
          id: await RoadmapId.unsafeGenerate(),
          createdAt: new Date(),
          updatedAt: new Date(),
          name: data.value.name,
          slug: slugify(data.value.name),
          description: null,
          isPrimary: false,
          mode: "status",
          visibility: data.value.visibility,
          filter: emptyFilter,
          organizationId,
        });

        await tx.isPersisted.promise;
        onSuccess();
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
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
      </SheetPanel>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label="Save" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
