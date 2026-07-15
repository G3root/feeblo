import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
} from "@feeblo/id";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
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
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create {entityType} attribute</SheetTitle>
          <SheetDescription>
            Add a field your team can use on every {entityType}.
          </SheetDescription>
        </SheetHeader>
        <CustomAttributeCreateForm entityType={entityType} />
      </SheetContent>
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
      type: "TEXT" as AttributeType,
    },
    validators: {
      onSubmit: z.object({
        description: z.string(),
        isRequired: z.boolean(),
        //TODO add keyValidation
        key: z
          .string()
          .trim()
          .min(1, "Enter an attribute key")
          .regex(
            /^[a-z][a-z0-9_]*$/,
            "Use lowercase letters, numbers, and underscores"
          ),
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
        key: value.key.trim(),
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
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: `${capitalize(entityType)} attribute created`,
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: `Failed to create ${entityType} attribute`,
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
        <form.AppField
          children={(field) => (
            <field.TextField label="Name" placeholder="e.g. Customer tier" />
          )}
          name="name"
        />
        <form.AppField
          children={(field) => (
            <field.TextField
              autoCapitalize="none"
              label="Key"
              placeholder="customer_tier"
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
                  field.handleChange(value as AttributeType)
                }
                value={field.state.value}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {attributeTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
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
      </div>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Create attribute" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
