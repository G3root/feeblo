import { ContactId } from "@feeblo/id";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
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
  createContactAction,
  getContactCustomAttributeValueChanges,
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
  const { companyCollection, contactAttributeDefinitionCollection } =
    useDashboardCollections();
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
  const { data: companies = [] } = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) => eq(company.organizationId, organizationId))
        .orderBy(({ company }) => company.name, "asc"),
    [organizationId]
  );
  const form = useAppForm({
    defaultValues: {
      attributes: {},
      companyId: "none",
      email: "",
      externalId: "",
      name: "",
      phone: "",
    },
    validators: {
      onSubmit: z.object({
        email: z.email(),
        companyId: z.string(),
        externalId: z.string(),
        name: z.string(),
        phone: z.string(),
        attributes: z.record(z.string(), z.any()),
      }),
    },
    onSubmit: async (data) => {
      try {
        const contactId = await ContactId.unsafeGenerate();
        const now = new Date();
        const contact = {
          id: contactId,
          organizationId,
          externalId: data.value.externalId || null,
          email: data.value.email,
          name: data.value.name || null,
          phone: data.value.phone || null,
          avatar: null,
          companyId:
            data.value.companyId === "none" ? null : data.value.companyId,
          createdAt: now,
          updatedAt: now,
        };
        const { createAttribute } = await getContactCustomAttributeValueChanges(
          {
            contactId,
            definitions,
            existingValues: [],
            organizationId,
            values: data.value.attributes,
          }
        );
        //TODO add error validation
        await createContactAction({
          contact,
          createAttribute,
          operation: "create",
        });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Contact created", type: "success" });
      } catch (error) {
        toastManager.add({
          title: hasExistingRecordError(error)
            ? "A contact with this email already exists"
            : "Failed to create contact",
          type: "error",
        });
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
          children={(field) => <field.TextField label="External ID" />}
          name="externalId"
        />
        <form.AppField
          children={(field) => <field.TextField label="Phone" type="tel" />}
          name="phone"
        />
        <form.AppField
          children={(field) => (
            <div className="space-y-2">
              <label
                className="font-medium text-sm"
                htmlFor="contact-create-company-id"
              >
                Company
              </label>
              <Select
                onValueChange={(value) => field.handleChange(value ?? "none")}
                value={field.state.value}
              >
                <SelectTrigger
                  className="w-full"
                  id="contact-create-company-id"
                >
                  <SelectValue placeholder="Select a company">
                    {(value) =>
                      value === "none"
                        ? "None"
                        : (companies.find((company) => company.id === value)
                            ?.name ?? "Select a company")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          name="companyId"
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

function hasExistingRecordError(error: unknown) {
  return String(error).includes("ContactAlreadyExistsError");
}
