import { ContactId } from "@feeblo/id";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import {
  CustomAttributeFields,
  saveContactCustomAttributeValues,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useOrganizationId } from "~/hooks/use-organization-id";
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
  const {
    contactAttributeDefinitionCollection,
    contactAttributeValueCollection,
    contactCollection,
  } = useDashboardCollections();
  const store = useContactCreateDialogContext();
  const { data: definitions = [] } = useLiveQuery(
    (q) =>
      q
        .from({ definition: contactAttributeDefinitionCollection })
        .where(({ definition }) =>
          eq(definition.organizationId, organizationId)
        )
        .orderBy(({ definition }) => definition.createdAt, "asc"),
    [organizationId]
  );
  const form = useAppForm({
    defaultValues: {
      attributes: {},
      email: "",
      name: "",
      phone: "",
    },
    validators: {
      onSubmit: z.object({
        email: z.email(),
        name: z.string(),
        phone: z.string(),
        attributes: z.record(z.string(), z.any()),
      }),
    },
    onSubmit: async (data) => {
      try {
        const contactId = await ContactId.unsafeGenerate();
        const tx = contactCollection.insert({
          id: contactId,
          organizationId,
          externalId: null,
          email: data.value.email,
          name: data.value.name || null,
          phone: data.value.phone || null,
          avatar: null,
          companyId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await tx.isPersisted.promise;
        await saveContactCustomAttributeValues({
          contactAttributeValueCollection,
          contactId,
          definitions,
          existingValues: [],
          organizationId,
          values: data.value.attributes,
        });
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
        <form.Subscribe selector={(state) => state.values.attributes}>
          {(attributes) => (
            <CustomAttributeFields
              definitions={definitions}
              entityName="contact"
              onChange={(attributeId, value) =>
                form.setFieldValue(`attributes.${attributeId}`, value)
              }
              values={attributes}
            />
          )}
        </form.Subscribe>
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Create contact" />
        </form.AppForm>
      </div>
    </form>
  );
}
