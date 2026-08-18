import { CompanyId } from "@feeblo/id";
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
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import {
  CustomAttributeFields,
  createCompanyAction,
  getCompanyCustomAttributeValueChanges,
  hasMissingRequiredCustomAttributeValues,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useCompanyCreateDialogContext } from "../dialog-stores";

export function CompanyCreateDialog() {
  const store = useCompanyCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create company</SheetTitle>
          <SheetDescription>Add a company to this workspace.</SheetDescription>
        </SheetHeader>
        <CompanyCreateForm />
      </SheetPopup>
    </Sheet>
  );
}

function CompanyCreateForm() {
  const organizationId = useOrganizationId();
  const { companyAttributeDefinitionCollection } = useDashboardCollections();
  const store = useCompanyCreateDialogContext();
  const definitionsQuery = useLiveQuery(
    (q) =>
      q
        .from({ definition: companyAttributeDefinitionCollection })
        .where(({ definition }) =>
          eq(definition.organizationId, organizationId)
        )
        .orderBy(({ definition }) => definition.createdAt, "asc"),
    [organizationId]
  );
  const definitions = definitionsQuery.data ?? [];
  const form = useAppForm({
    defaultValues: { attributes: {}, externalId: "", name: "" },
    validators: {
      onSubmit: z.object({
        externalId: z.string(),
        name: z.string().trim().min(1, "Enter a company name"),
        attributes: z.record(z.string(), z.any()),
      }),
    },
    onSubmit: async (data) => {
      const hasMissingRequiredValue = hasMissingRequiredCustomAttributeValues(
        definitions,
        data.value.attributes
      );

      if (hasMissingRequiredValue) {
        toastManager.add({
          title: "Complete all required custom fields",
          type: "error",
        });
        return;
      }

      try {
        const companyId = await CompanyId.unsafeGenerate();
        const now = new Date();
        const company = {
          id: companyId,
          organizationId,
          externalId: data.value.externalId || null,
          name: data.value.name,
          avatar: null,
          externalCreatedAt: null,
          createdAt: now,
          updatedAt: now,
          source: "DASHBOARD" as const,
        };
        const { createAttribute } = await getCompanyCustomAttributeValueChanges(
          {
            companyId,
            definitions,
            existingValues: [],
            organizationId,
            values: data.value.attributes,
          }
        );
        //TODO add error validation
        await createCompanyAction({
          company,
          createAttribute,
          operation: "create",
        });
        trackEvent("company_created", { success: true });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Company created", type: "success" });
      } catch (error) {
        trackEvent("company_created", { success: false });
        toastManager.add({
          title: parseRpcError(error).message,
          type: "error",
        });
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
        <form.AppField name="externalId">
          {(field) => <field.TextField label="External ID" />}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.attributes}>
          {(attributes) => (
            <CustomAttributeFields
              definitions={definitions}
              entityName="company"
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
          <form.SubscribeButton label="Create company" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
