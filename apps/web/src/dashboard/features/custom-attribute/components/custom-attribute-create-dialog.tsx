import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
} from "@feeblo/id";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
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
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import { toCamelCaseAttributeKey } from "@feeblo/utils/scule";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  type CustomAttributeEntityType,
  useCustomAttributeCreateDialogContext,
} from "../dialog-stores";

const attributeTypes = [
  { label: "Text", value: "TEXT" },
  { label: "Integer", value: "INTEGER" },
  { label: "Decimal", value: "DECIMAL" },
  { label: "Yes / no", value: "BOOLEAN" },
  { label: "Date", value: "DATE" },
] as const;

type AttributeType = (typeof attributeTypes)[number]["value"];

export function CustomAttributeCreateDialog() {
  const store = useCustomAttributeCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const entityType = useSelector(
    store,
    (state) => state.context.data.entityType
  );

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create {entityType} attribute</SheetTitle>
          <SheetDescription>
            Add a field your team can use on every {entityType}.
          </SheetDescription>
        </SheetHeader>
        <CustomAttributeCreateForm entityType={entityType} />
      </SheetPopup>
    </Sheet>
  );
}

function CustomAttributeCreateForm({
  entityType,
}: {
  entityType: CustomAttributeEntityType;
}) {
  const organizationId = useOrganizationId();
  const {
    companyAttributeDefinitionCollection,
    contactAttributeDefinitionCollection,
  } = useDashboardCollections();
  const store = useCustomAttributeCreateDialogContext();

  const form = useAppForm({
    defaultValues: {
      description: "",
      isRequired: false,
      key: "",
      name: "",
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      type: "TEXT" as AttributeType,
    },
    validators: {
      onSubmit: z.object({
        description: z.string(),
        isRequired: z.boolean(),
        key: z.string().min(1, "Enter an attribute name first"),
        name: z.string().trim().min(1, "Enter an attribute name"),
        type: z.enum(["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "DATE"]),
      }),
    },
    onSubmit: async ({ value }) => {
      const now = new Date();
      const commonDefinition = {
        config: null,
        createdAt: now,
        description: value.description.trim() || null,
        isRequired: value.isRequired,
        key: toCamelCaseAttributeKey(value.name),
        name: value.name.trim(),
        organizationId,
        type: value.type,
        updatedAt: now,
      };

      try {
        const transaction =
          entityType === "contact"
            ? contactAttributeDefinitionCollection.insert({
                ...commonDefinition,
                id: await ContactAttributeDefinitionId.unsafeGenerate(),
              })
            : companyAttributeDefinitionCollection.insert({
                ...commonDefinition,
                id: await CompanyAttributeDefinitionId.unsafeGenerate(),
              });

        await transaction.isPersisted.promise;
        trackEvent("custom_attribute_created", {
          entity_type: entityType,
          success: true,
        });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: `${capitalize(entityType)} attribute created`,
          type: "success",
        });
      } catch (_error) {
        trackEvent("custom_attribute_created", {
          entity_type: entityType,
          success: false,
        });
        toastManager.add({
          title: `Failed to create ${entityType} attribute`,
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
        <form.AppField
          children={(field) => (
            <field.TextField
              label="Name"
              onChange={(event) =>
                form.setFieldValue(
                  "key",
                  toCamelCaseAttributeKey(event.target.value)
                )
              }
              placeholder="e.g. Customer tier"
            />
          )}
          name="name"
        />
        <form.AppField
          children={(field) => (
            <field.TextField
              autoCapitalize="none"
              disabled
              label="Key"
              placeholder="customerTier"
              spellCheck={false}
            />
          )}
          name="key"
        />
        <form.AppField
          children={(field) => (
            <field.TextareaField
              label="Description"
              placeholder="Explain how your team should use this field"
              rows={3}
            />
          )}
          name="description"
        />
        <form.AppField
          children={(field) => (
            <Field>
              <FieldLabel>Data type</FieldLabel>
              <Select
                onValueChange={(value) =>
                  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                  field.handleChange(value as AttributeType)
                }
                value={field.state.value}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {attributeTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <FieldDescription>
                The data type cannot be changed after creation.
              </FieldDescription>
            </Field>
          )}
          name="type"
        />
        <form.AppField
          children={(field) => (
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="attribute-required">Required</FieldLabel>
                <FieldDescription>
                  Mark this field as expected for every {entityType}.
                </FieldDescription>
              </div>
              <Switch
                checked={field.state.value}
                id="attribute-required"
                onCheckedChange={field.handleChange}
              />
            </Field>
          )}
          name="isRequired"
        />
      </SheetPanel>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label="Create attribute" variant="brand" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
