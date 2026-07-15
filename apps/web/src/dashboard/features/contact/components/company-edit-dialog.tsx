import type {
  TCompanyAttributeDefinition,
  TCompanyAttributeValue,
} from "@feeblo/domain/attribute-definition/schema";
import type { TCompany } from "@feeblo/domain/company/schema";
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
  createCompanyAction,
  getCompanyCustomAttributeValueChanges,
  getCustomAttributeInputValues,
  hasMissingRequiredCustomAttributeValues,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useCompanyEditDialogContext } from "../dialog-stores";

export function CompanyEditDialog() {
  const store = useCompanyEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit company</SheetTitle>
          <SheetDescription>Update this company&apos;s name.</SheetDescription>
        </SheetHeader>
        <div className="p-4">{open ? <CompanyEditFormLoader /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}

function CompanyEditFormLoader() {
  const organizationId = useOrganizationId();
  const {
    companyAttributeDefinitionCollection,
    companyAttributeValueCollection,
    companyCollection,
  } = useDashboardCollections();
  const store = useCompanyEditDialogContext();
  const companyId = useSelector(store, (state) => state.context.data.companyId);
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) =>
          and(
            eq(company.id, companyId),
            eq(company.organizationId, organizationId)
          )
        )
        .orderBy(({ company }) => company.updatedAt, "desc")
        .limit(1),
    [companyId, organizationId]
  );
  const company = data?.[0];
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
  const valuesQuery = useLiveQuery(
    (q) =>
      q
        .from({ value: companyAttributeValueCollection })
        .where(({ value }) => eq(value.companyId, companyId)),
    [companyId]
  );

  if (!company) {
    return null;
  }

  return (
    <CompanyEditForm
      company={company}
      definitions={definitionsQuery.data ?? []}
      existingValues={valuesQuery.data ?? []}
    />
  );
}

function CompanyEditForm({
  company,
  definitions,
  existingValues,
}: {
  company: TCompany;
  definitions: readonly TCompanyAttributeDefinition[];
  existingValues: readonly TCompanyAttributeValue[];
}) {
  const organizationId = useOrganizationId();
  const store = useCompanyEditDialogContext();
  const form = useAppForm({
    defaultValues: {
      attributes: getCustomAttributeInputValues(definitions, existingValues),
      name: company.name,
    },
    validators: {
      onSubmit: z.object({
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
        const { createAttribute, upsertAttribute } =
          await getCompanyCustomAttributeValueChanges({
            companyId: company.id,
            definitions,
            existingValues,
            organizationId,
            values: data.value.attributes,
          });
        await createCompanyAction({
          company: {
            ...company,
            name: data.value.name,
            updatedAt: new Date(),
          },
          createAttribute,
          operation: "update",
          upsertAttribute,
        });
        store.send({ type: "toggle" });
        toastManager.add({ title: "Company updated", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to update company", type: "error" });
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
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Save changes" />
        </form.AppForm>
      </div>
    </form>
  );
}
