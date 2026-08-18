import type {
  TContactAttributeDefinition,
  TContactAttributeValue,
} from "@feeblo/domain/attribute-definition/schema";
import type { TContact } from "@feeblo/domain/contact/schema";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
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
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import {
  CustomAttributeFields,
  createContactAction,
  getContactCustomAttributeValueChanges,
  getCustomAttributeInputValues,
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
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Edit contact</SheetTitle>
          <SheetDescription>Update this person's details.</SheetDescription>
        </SheetHeader>
        {open ? <ContactEditForm /> : null}
      </SheetPopup>
    </Sheet>
  );
}

function ContactEditForm() {
  const organizationId = useOrganizationId();
  const {
    companyCollection,
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
  const companiesQuery = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) => eq(company.organizationId, organizationId))
        .orderBy(({ company }) => company.name, "asc"),
    [organizationId]
  );

  if (
    !contact ||
    definitionsQuery.isLoading ||
    attributeValuesQuery.isLoading ||
    companiesQuery.isLoading
  ) {
    return null;
  }

  return (
    <ContactEditFormFields
      attributeValues={attributeValuesQuery.data ?? []}
      companies={companiesQuery.data ?? []}
      contact={contact}
      definitions={definitionsQuery.data ?? []}
    />
  );
}

type ContactEditFormFieldsProps = {
  contact: TContact;
};

function ContactEditFormFields({
  attributeValues: existingValues,
  companies,
  contact,
  definitions,
}: ContactEditFormFieldsProps & {
  attributeValues: readonly TContactAttributeValue[];
  companies: readonly { id: string; name: string }[];
  definitions: readonly TContactAttributeDefinition[];
}) {
  const organizationId = useOrganizationId();
  const store = useContactEditDialogContext();
  const form = useAppForm({
    defaultValues: {
      attributes: getCustomAttributeInputValues(definitions, existingValues),
      companyId: contact.companyId ?? "none",
      email: contact.email ?? "",
      externalId: contact.externalId ?? "",
      name: contact.name ?? "",
      phone: contact.phone ?? "",
    },
    validators: {
      onSubmit: z.object({
        companyId: z.string(),
        email: z.email("Enter a valid email address"),
        externalId: z.string(),
        name: z.string(),
        phone: z.string(),
        attributes: z.record(z.string(), z.any()),
      }),
    },
    onSubmit: async (data) => {
      try {
        const { createAttribute, upsertAttribute } =
          await getContactCustomAttributeValueChanges({
            contactId: contact.id,
            definitions,
            existingValues,
            organizationId,
            values: data.value.attributes,
          });
        //TODO add error validation
        await createContactAction({
          contact: {
            ...contact,
            companyId:
              data.value.companyId === "none" ? null : data.value.companyId,
            email: data.value.email,
            externalId: data.value.externalId || null,
            name: data.value.name || null,
            phone: data.value.phone || null,
            updatedAt: new Date(),
          },
          createAttribute,
          operation: "update",
          upsertAttribute,
        });
        trackEvent("contact_updated", { success: true });
        store.send({ type: "setOpen", open: false });
        toastManager.add({ title: "Contact updated", type: "success" });
      } catch {
        trackEvent("contact_updated", { success: false });
        toastManager.add({ title: "Failed to update contact", type: "error" });
      }
    },
  });

  return (
    <form
      className="contents"
      data-slot="form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <SheetPanel className="grid gap-4">
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>
        <form.AppField name="email">
          {(field) => <field.TextField label="Email" type="email" />}
        </form.AppField>
        <form.AppField name="externalId">
          {(field) => <field.TextField label="External ID" />}
        </form.AppField>
        <form.AppField name="phone">
          {(field) => <field.TextField label="Phone" type="tel" />}
        </form.AppField>
        <form.AppField name="companyId">
          {(field) => (
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="contact-edit-company-id"
              >
                Company
              </label>
              <Select
                onValueChange={(value) => field.handleChange(value ?? "none")}
                value={field.state.value}
              >
                <SelectTrigger className="w-full" id="contact-edit-company-id">
                  <SelectValue placeholder="Select a company">
                    {(value) =>
                      value === "none"
                        ? "None"
                        : (companies.find((company) => company.id === value)
                            ?.name ?? "Select a company")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="none">None</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}
        </form.AppField>
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
      </SheetPanel>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label="Save changes" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
