import { ContactId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
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
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import {
  CustomAttributeFields,
  createContactAction,
  getContactCustomAttributeValueChanges,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useEntitlements } from "~/hooks/use-entitlements";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useContactCreateDialogContext } from "../dialog-stores";

export function ContactCreateDialog() {
  const store = useContactCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create contact</SheetTitle>
          <SheetDescription>Add a person to this workspace.</SheetDescription>
        </SheetHeader>
        <ContactCreateForm />
      </SheetPopup>
    </Sheet>
  );
}

function ContactCreateForm() {
  const organizationId = useOrganizationId();
  const {
    companyCollection,
    contactAttributeDefinitionCollection,
    contactCollection,
  } = useDashboardCollections();
  const store = useContactCreateDialogContext();
  const upgradePlanStore = useUpgradePlanDialogContext();
  const { entitlements } = useEntitlements();
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
  const { data: contacts = [] } = useLiveQuery(
    (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) => eq(contact.organizationId, organizationId)),
    [organizationId]
  );
  const crmLimit = entitlements.limits.crmEntries;
  const totalCrmEntries = contacts.length + companies.length;
  const atLimit = crmLimit !== null && totalCrmEntries >= crmLimit;
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
          source: "DASHBOARD" as const,
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
        trackEvent("contact_created", { success: true });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Contact created", type: "success" });
      } catch (error) {
        trackEvent("contact_created", { success: false });
        toastManager.add({
          title: parseRpcError(error).message,
          type: "error",
        });
      }
    },
  });
  if (atLimit) {
    return (
      <div className="p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={SparklesIcon} />
            </EmptyMedia>
            <EmptyTitle>CRM limit reached</EmptyTitle>
            <EmptyDescription>
              The {crmLimit} CRM entry limit for your plan has been reached (
              {totalCrmEntries} of {crmLimit} used). Upgrade to create more
              contacts and companies.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                store.send({ type: "toggle" });
                upgradePlanStore.send({ type: "toggle" });
              }}
              size="sm"
              type="button"
            >
              <HugeiconsIcon icon={SparklesIcon} />
              Upgrade plan
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

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
          <form.SubscribeButton label="Create contact" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
