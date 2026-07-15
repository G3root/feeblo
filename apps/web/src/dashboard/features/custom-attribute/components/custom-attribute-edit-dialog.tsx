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
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import {
  type CustomAttributeEntityType,
  useCustomAttributeEditDialogContext,
} from "../dialog-stores";

const attributeTypes = [
  { label: "Text", value: "TEXT" },
  { label: "Integer", value: "INTEGER" },
  { label: "Decimal", value: "DECIMAL" },
  { label: "Yes / no", value: "BOOLEAN" },
  { label: "Date", value: "DATE" },
] as const;

function getCollection(
  entityType: CustomAttributeEntityType,
  collections: ReturnType<typeof useDashboardCollections>
) {
  return entityType === "contact"
    ? collections.contactAttributeDefinitionCollection
    : collections.companyAttributeDefinitionCollection;
}

export function CustomAttributeEditDialog() {
  const store = useCustomAttributeEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const entityType = useSelector(
    store,
    (state) => state.context.data.entityType
  );

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {entityType} attribute</SheetTitle>
          <SheetDescription>
            Update the settings for this custom attribute.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">{open ? <CustomAttributeEditForm /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}

function CustomAttributeEditForm() {
  const organizationId = useOrganizationId();
  const collections = useDashboardCollections();
  const store = useCustomAttributeEditDialogContext();
  const attributeId = useSelector(
    store,
    (state) => state.context.data.attributeId
  );
  const entityType = useSelector(
    store,
    (state) => state.context.data.entityType
  );

  const collection = getCollection(entityType, collections);

  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ attribute: collection })
        .where((a) =>
          and(
            eq(a.attribute.id, attributeId),
            eq(a.attribute.organizationId, organizationId)
          )
        )
        .orderBy((a) => a.attribute.createdAt, "desc")
        .limit(1),
    [organizationId, attributeId]
  );

  const attribute = data[0];

  const form = useAppForm({
    defaultValues: {
      description: attribute.description ?? "",
      isRequired: attribute.isRequired,
      name: attribute.name,
    },
    validators: {
      onSubmit: z.object({
        description: z.string(),
        isRequired: z.boolean(),
        name: z.string().trim().min(1, "Enter an attribute name"),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = collection.update(attributeId, (draft) => {
          draft.name = data.value.name;
          draft.description = data.value.description.trim() || null;
          draft.isRequired = data.value.isRequired;
          draft.updatedAt = new Date();
        });

        await tx.isPersisted.promise;
        toastManager.add({
          title: "Attribute updated successfully",
          type: "success",
        });
        store.send({ type: "toggle" });
      } catch (_error) {
        toastManager.add({
          title: "Failed to update attribute",
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
      <div className="space-y-5">
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
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
        <Field>
          <FieldLabel>Data type</FieldLabel>
          <Select disabled value={attribute.type}>
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
      <div className="fixed right-2 bottom-8 w-full sm:max-w-92.5">
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Save changes" />
        </form.AppForm>
      </div>
    </form>
  );
}
