import { CompanyId } from "@feeblo/id";
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
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create company</SheetTitle>
          <SheetDescription>Add a company to this workspace.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <CompanyCreateForm />
        </div>
      </SheetContent>
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
        };
        const { createAttribute } =
          await getCompanyCustomAttributeValueChanges({
            companyId,
            definitions,
            existingValues: [],
            organizationId,
            values: data.value.attributes,
          });
        //TODO add error validation
        await createCompanyAction({
          company,
          createAttribute,
          operation: "create",
        });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Company created", type: "success" });
      } catch (error) {
        toastManager.add({
          title: hasExistingRecordError(error)
            ? "A company with this name already exists"
            : "Failed to create company",
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
          children={(field) => <field.TextField label="External ID" />}
          name="externalId"
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
          <form.SubscribeButton className="w-full" label="Create company" />
        </form.AppForm>
      </div>
    </form>
  );
}

function hasExistingRecordError(error: unknown) {
  return String(error).includes("AlreadyExistsError");
}
