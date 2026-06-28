import { TagId } from "@feeblo/id";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { slugify } from "@feeblo/utils/url";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useTagCreateDialogContext } from "../dialog-stores";

type TagType = "FEEDBACK" | "CHANGELOG";

export function TagCreateDialog() {
  const store = useTagCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create Tag</SheetTitle>
          <SheetDescription>
            Create a new tag for this workspace.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <TagCreateForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TagCreateForm() {
  const organizationId = useOrganizationId();
  const { tagCollection } = useDashboardCollections();
  const store = useTagCreateDialogContext();
  const type = store.get().context.data.type as TagType;

  const form = useAppForm({
    defaultValues: {
      name: "",
      type,
    },
    validators: {
      onSubmit: z.object({
        name: z.string(),
        type: z.enum(["FEEDBACK", "CHANGELOG"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const id = await TagId.unsafeGenerate();
        const tx = tagCollection.insert({
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: data.value.name,
          slug: slugify(data.value.name),
          type: data.value.type,
          organizationId,
        });

        await tx.isPersisted.promise;
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Tag created successfully",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to create tag",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppField
        children={(field) => <field.TextField label="Name" />}
        name="name"
      />

      <div className="fixed right-2 bottom-8 w-full sm:max-w-[370px]">
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Save" />
        </form.AppForm>
      </div>
    </form>
  );
}
