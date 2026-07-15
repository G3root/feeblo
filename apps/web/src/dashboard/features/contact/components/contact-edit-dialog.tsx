import type {
  TContactAttributeDefinition,
  TContactAttributeValue,
} from "@feeblo/domain/attribute-definition/schema";
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
import {
  CustomAttributeFields,
  getCustomAttributeInputValues,
  saveContactCustomAttributeValues,
} from "~/features/custom-attribute/components/custom-attribute-fields";
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
  const {
    contactAttributeDefinitionCollection,
    contactAttributeValueCollection,
    contactCollection,
  } = useDashboardCollections();
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
        .orderBy(({ contact }) => contact.updatedAt, "desc")
        .limit(1),
    [contactId, organizationId]
  );
  const contact = data[0];
  const definitionsQuery = useLiveQuery(
    (q) =>
      q
        .from({ definition: contactAttributeDefinitionCollection })
        .where(({ definition }) =>
          eq(definition.organizationId, organizationId)
        )
        .orderBy(({ definition }) => definition.createdAt, "asc"),
    [organizationId]
  );
  const attributeValuesQuery = useLiveQuery(
    (q) =>
      q
        .from({ value: contactAttributeValueCollection })
        .where(({ value }) => eq(value.contactId, contactId)),
    [contactId]
  );

  if (
    !contact ||
    definitionsQuery.isLoading ||
    attributeValuesQuery.isLoading
  ) {
    return null;
  }

  return (
    <ContactEditFormFields
      attributeValues={attributeValuesQuery.data ?? []}
      contact={contact}
      definitions={definitionsQuery.data ?? []}
    />
  );
}

type ContactEditFormFieldsProps = {
  contact: {
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  };
};

function ContactEditFormFields({
  attributeValues: existingValues,
  contact,
  definitions,
}: ContactEditFormFieldsProps & {
  attributeValues: readonly TContactAttributeValue[];
  definitions: readonly TContactAttributeDefinition[];
}) {
  const { contactAttributeValueCollection, contactCollection } =
    useDashboardCollections();
  const store = useContactEditDialogContext();
  const form = useAppForm({
    defaultValues: {
      attributes: getCustomAttributeInputValues(definitions, existingValues),
      email: contact.email ?? "",
      name: contact.name ?? "",
      phone: contact.phone ?? "",
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Enter a valid email address"),
        name: z.string(),
        phone: z.string(),
        attributes: z.record(z.string(), z.any()),
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
        await saveContactCustomAttributeValues({
          contactAttributeValueCollection,
          contactId: contact.id,
          definitions,
          existingValues,
          values: data.value.attributes,
        });
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
          <form.SubscribeButton className="w-full" label="Save changes" />
        </form.AppForm>
      </div>
    </form>
  );
}
