import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { boardCollection } from "~/lib/collections";
import { useCreateBoardDialogContext } from "../dialog-stores";

export function CreateBoardDialog() {
  const store = useCreateBoardDialogContext();

  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create Board.</SheetTitle>
          <SheetDescription>
            Create a new board to get started.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <CreateBoardForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CreateBoardForm() {
  const organizationId = useOrganizationId();
  const store = useCreateBoardDialogContext();
  const form = useAppForm({
    defaultValues: {
      name: "",
      visibility: "PUBLIC" as "PUBLIC" | "PRIVATE",
    },
    validators: {
      onChange: z.object({
        name: z.string(),
        visibility: z.enum(["PUBLIC", "PRIVATE"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = boardCollection.insert({
          id: generateId("board"),
          createdAt: new Date(),
          updatedAt: new Date(),
          name: data.value.name,
          visibility: data.value.visibility,
          slug: slugify(data.value.name),
          organizationId,
        });

        await tx.isPersisted.promise;
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Board created successfully",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to create board",
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
