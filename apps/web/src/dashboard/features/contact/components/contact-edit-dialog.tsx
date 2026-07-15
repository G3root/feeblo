import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useContactEditDialogContext } from "../dialog-stores";

export function ContactEditDialog() {
  const store = useContactEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit contact</SheetTitle>
          <SheetDescription>Update this person's details.</SheetDescription>
        </SheetHeader>
        <div className="p-4">{open ? <ContactEditForm /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}

function ContactEditForm() {
  const organizationId = useOrganizationId();
  const { contactCollection } = useDashboardCollections();
  const store = useContactEditDialogContext();
  const contactId = useSelector(store, (state) => state.context.data.contactId);
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) =>
          and(
            eq(contact.id, contactId),
            eq(contact.organizationId, organizationId)
          )
        )
        .limit(1),
    [contactId, organizationId]
  );
  const contact = data[0];

  if (!contact) {
    return null;
  }

  return <ContactEditFormFields contact={contact} />;
}

type ContactEditFormFieldsProps = {
  contact: {
    email: string;
    id: string;
    name: string | null;
    phone: string | null;
  };
};

function ContactEditFormFields({ contact }: ContactEditFormFieldsProps) {
  const { contactCollection } = useDashboardCollections();
  const store = useContactEditDialogContext();
  const form = useAppForm({
    defaultValues: {
      email: contact.email,
      name: contact.name ?? "",
      phone: contact.phone ?? "",
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
        const tx = contactCollection.update(contact.id, (draft) => {
          draft.email = data.value.email;
          draft.name = data.value.name || null;
          draft.phone = data.value.phone || null;
          draft.updatedAt = new Date();
        });

        await tx.isPersisted.promise;
        store.send({ type: "setOpen", open: false });
        toastManager.add({ title: "Contact updated", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to update contact", type: "error" });
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
          <form.SubscribeButton className="w-full" label="Save changes" />
        </form.AppForm>
      </div>
    </form>
  );
}
