import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useContactCreateDialogContext } from "../dialog-stores";

export function ContactCreateDialog() {
  const store = useContactCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create contact</SheetTitle>
          <SheetDescription>Add a person to this workspace.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <ContactCreateForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ContactCreateForm() {
  const organizationId = useOrganizationId();
  const { contactCollection } = useDashboardCollections();
  const store = useContactCreateDialogContext();
  const form = useAppForm({
    defaultValues: {
      email: "",
      name: "",
      phone: "",
    },
    validators: {
      onSubmit: z.object({
        email: z.string().email("Enter a valid email address"),
        name: z.string(),
        phone: z.string(),
      }),
    },
    onSubmit: async (data) => {
      try {
        //TODO fix insertation
        const contact = await fetchRpc((rpc) =>
          rpc.ContactUpsert({
            organizationId,
            email: data.value.email,
            name: data.value.name || undefined,
            phone: data.value.phone || undefined,
          })
        );

        if (!contact) {
          throw new Error("Contact was not created");
        }

        contactCollection.insert(contact);
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Contact created", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to create contact", type: "error" });
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="space-y-4">
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <form.AppField
          children={(field) => <field.TextField label="Email" type="email" />}
          name="email"
        />
        <form.AppField
          children={(field) => <field.TextField label="Phone" type="tel" />}
          name="phone"
        />
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Create contact" />
        </form.AppForm>
      </div>
    </form>
  );
}
