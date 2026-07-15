/** biome-ignore-all lint/style/useDefaultSwitchClause: <explanation> */
import type {
  TCompanyAttributeValue,
  TCompanyAttributeValueUpsert,
  TContactAttributeValue,
  TContactAttributeValueUpsert,
} from "@feeblo/domain/attribute-definition/schema";
import { CompanyAttributeValueId, ContactAttributeValueId } from "@feeblo/id";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Input } from "@feeblo/ui/input";
import { Label } from "@feeblo/ui/label";
import { createTransaction } from "@tanstack/react-db";
import {
  companyAttributeValueCollection,
  contactAttributeValueCollection,
} from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

export type CustomAttributeDefinition = {
  id: string;
  isRequired: boolean;
  name: string;
  type: "BOOLEAN" | "DATE" | "DECIMAL" | "INTEGER" | "TEXT";
};

export type CustomAttributeValue = {
  attributeId: string;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDecimal: number | null;
  valueInteger: number | null;
  valueText: string | null;
};

export type CustomAttributeInputValue = boolean | string;
export type CustomAttributeInputValues = Record<
  string,
  CustomAttributeInputValue | undefined
>;

type AttributeValueUpsert =
  | TCompanyAttributeValueUpsert["value"]
  | TContactAttributeValueUpsert["value"];

export function CustomAttributeFields({
  definitions,
  entityName,
  onChange,
  values,
}: {
  definitions: readonly CustomAttributeDefinition[];
  entityName: "company" | "contact";
  onChange: (attributeId: string, value: CustomAttributeInputValue) => void;
  values: CustomAttributeInputValues;
}) {
  if (definitions.length === 0) {
    return null;
  }

  return (
    <fieldset className="space-y-4 border-t pt-4">
      <legend className="font-medium text-sm">Custom details</legend>
      {definitions.map((definition) => {
        const id = `${entityName}-attribute-${definition.id}`;
        const value = values[definition.id] ?? defaultInputValue(definition);

        if (definition.type === "BOOLEAN") {
          return (
            <div className="flex items-center gap-2" key={definition.id}>
              <Checkbox
                checked={value === true}
                id={id}
                onCheckedChange={(checked) =>
                  onChange(definition.id, checked === true)
                }
              />
              <Label htmlFor={id}>
                {definition.name}
                {definition.isRequired ? " *" : null}
              </Label>
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-2" key={definition.id}>
            <Label htmlFor={id}>
              {definition.name}
              {definition.isRequired ? " *" : null}
            </Label>
            <Input
              id={id}
              onChange={(event) => onChange(definition.id, event.target.value)}
              required={definition.isRequired}
              step={definition.type === "INTEGER" ? "1" : undefined}
              type={inputType(definition.type)}
              value={typeof value === "string" ? value : ""}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

export function getCustomAttributeInputValue(
  definition: CustomAttributeDefinition,
  value: CustomAttributeValue | undefined
): CustomAttributeInputValue {
  if (!value) {
    return defaultInputValue(definition);
  }

  switch (definition.type) {
    case "BOOLEAN":
      return value.valueBoolean ?? false;
    case "DATE":
      return value.valueDate ? toDateInputValue(value.valueDate) : "";
    case "DECIMAL":
      return value.valueDecimal?.toString() ?? "";
    case "INTEGER":
      return value.valueInteger?.toString() ?? "";
    case "TEXT":
      return value.valueText ?? "";
    default:
      throw new Error("unknown definition type");
  }
}

export function getCustomAttributeInputValues(
  definitions: readonly CustomAttributeDefinition[],
  values: readonly CustomAttributeValue[]
): CustomAttributeInputValues {
  const valuesByAttributeId = new Map(
    values.map((value) => [value.attributeId, value])
  );

  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      getCustomAttributeInputValue(
        definition,
        valuesByAttributeId.get(definition.id)
      ),
    ])
  );
}

export function hasMissingRequiredCustomAttributeValues(
  definitions: readonly CustomAttributeDefinition[],
  values: CustomAttributeInputValues
) {
  return definitions.some((definition) => {
    const value = values[definition.id] ?? defaultInputValue(definition);
    return definition.isRequired && value === "";
  });
}

export function toCustomAttributeValueColumns(
  definition: CustomAttributeDefinition,
  input: CustomAttributeInputValue
) {
  const emptyColumns = {
    valueBoolean: null,
    valueDate: null,
    valueDecimal: null,
    valueInteger: null,
    valueText: null,
  };

  switch (definition.type) {
    case "BOOLEAN":
      return { ...emptyColumns, valueBoolean: input === true };
    case "DATE":
      return {
        ...emptyColumns,
        valueDate:
          typeof input === "string" && input
            ? new Date(`${input}T00:00:00`)
            : null,
      };
    case "DECIMAL":
      return {
        ...emptyColumns,
        valueDecimal: typeof input === "string" && input ? Number(input) : null,
      };
    case "INTEGER":
      return {
        ...emptyColumns,
        valueInteger: typeof input === "string" && input ? Number(input) : null,
      };
    case "TEXT":
      return {
        ...emptyColumns,
        valueText: typeof input === "string" && input ? input : null,
      };
  }
}

export function formatCustomAttributeValue(
  value: CustomAttributeValue | undefined
) {
  if (!value) {
    return "—";
  }

  if (value.valueBoolean !== null) {
    return value.valueBoolean ? "Yes" : "No";
  }

  return (
    value.valueText ??
    value.valueInteger?.toString() ??
    value.valueDecimal?.toString() ??
    (value.valueDate ? toDateInputValue(value.valueDate) : "—")
  );
}

function getCustomAttributeValueChanges<
  TExistingValue extends CustomAttributeValue & { id: string },
>({
  definitions,
  existingValues,
  values,
}: {
  definitions: readonly CustomAttributeDefinition[];
  existingValues: readonly TExistingValue[];
  values: CustomAttributeInputValues;
}) {
  const existingByAttributeId = new Map(
    existingValues.map((value) => [value.attributeId, value])
  );
  const inserts: Array<{
    definition: CustomAttributeDefinition;
    valueColumns: ReturnType<typeof toCustomAttributeValueColumns>;
  }> = [];
  const updates: Array<{
    existingValue: TExistingValue;
    valueColumns: ReturnType<typeof toCustomAttributeValueColumns>;
  }> = [];

  for (const definition of definitions) {
    const input = values[definition.id] ?? defaultInputValue(definition);
    const existingValue = existingByAttributeId.get(definition.id);

    if (!existingValue && input === "" && !definition.isRequired) {
      continue;
    }

    const valueColumns = toCustomAttributeValueColumns(definition, input);
    if (existingValue) {
      if (input !== getCustomAttributeInputValue(definition, existingValue)) {
        updates.push({ existingValue, valueColumns });
      }
      continue;
    }

    inserts.push({ definition, valueColumns });
  }

  return { inserts, updates };
}

export async function saveContactCustomAttributeValues({
  contactId,
  definitions,
  existingValues,
  organizationId,
  values,
}: {
  contactId: string;
  definitions: readonly CustomAttributeDefinition[];
  existingValues: readonly (CustomAttributeValue & {
    contactId: string;
    createdAt: Date;
    id: string;
    updatedAt: Date;
  })[];
  organizationId: string;
  values: CustomAttributeInputValues;
}) {
  const { inserts, updates } = getCustomAttributeValueChanges({
    definitions,
    existingValues,
    values,
  });
  const insertValues = await Promise.all(
    inserts.map(async ({ definition, valueColumns }) => ({
      id: await ContactAttributeValueId.unsafeGenerate(),
      contactId,
      organizationId,
      attributeId: definition.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...valueColumns,
    }))
  );
  const persistencePromises: Promise<unknown>[] = [];

  if (insertValues.length > 0) {
    const transaction = createTransaction<TContactAttributeValue>({
      autoCommit: false,
      mutationFn: ({ transaction }) =>
        Promise.all(
          transaction.mutations.map(({ modified: value }) =>
            fetchRpc((rpc) =>
              rpc.ContactAttributeValueUpsert({
                id: value.id,
                attributeId: value.attributeId,
                contactId: value.contactId,
                organizationId: value.organizationId,
                value: getAttributeValue(value),
              })
            )
          )
        ),
    });
    transaction.mutate(() => {
      for (const value of insertValues) {
        contactAttributeValueCollection.insert(value);
      }
    });
    persistencePromises.push(transaction.commit());
  }

  if (updates.length > 0) {
    const transaction = createTransaction<TContactAttributeValue>({
      autoCommit: false,
      mutationFn: ({ transaction }) =>
        Promise.all(
          transaction.mutations.map(({ modified: value }) =>
            fetchRpc((rpc) =>
              rpc.ContactAttributeValueUpsert({
                id: value.id,
                attributeId: value.attributeId,
                contactId: value.contactId,
                organizationId: value.organizationId,
                value: getAttributeValue(value),
              })
            )
          )
        ),
    });
    transaction.mutate(() => {
      for (const { existingValue, valueColumns } of updates) {
        contactAttributeValueCollection.update(existingValue.id, (draft) => {
          Object.assign(draft, valueColumns, { updatedAt: new Date() });
        });
      }
    });
    persistencePromises.push(transaction.commit());
  }

  await Promise.all(persistencePromises);
}

export async function saveCompanyCustomAttributeValues({
  companyId,
  definitions,
  existingValues,
  organizationId,
  values,
}: {
  companyId: string;
  definitions: readonly CustomAttributeDefinition[];
  existingValues: readonly (CustomAttributeValue & {
    companyId: string;
    createdAt: Date;
    id: string;
    updatedAt: Date;
  })[];
  organizationId: string;
  values: CustomAttributeInputValues;
}) {
  const { inserts, updates } = getCustomAttributeValueChanges({
    definitions,
    existingValues,
    values,
  });
  const insertValues = await Promise.all(
    inserts.map(async ({ definition, valueColumns }) => ({
      id: await CompanyAttributeValueId.unsafeGenerate(),
      companyId,
      organizationId,
      attributeId: definition.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...valueColumns,
    }))
  );
  const persistencePromises: Promise<unknown>[] = [];

  if (insertValues.length > 0) {
    const transaction = createTransaction<TCompanyAttributeValue>({
      autoCommit: false,
      mutationFn: ({ transaction }) =>
        Promise.all(
          transaction.mutations.map(({ modified: value }) =>
            fetchRpc((rpc) =>
              rpc.CompanyAttributeValueUpsert({
                id: value.id,
                attributeId: value.attributeId,
                companyId: value.companyId,
                organizationId: value.organizationId,
                value: getAttributeValue(value),
              })
            )
          )
        ),
    });
    transaction.mutate(() => {
      for (const value of insertValues) {
        companyAttributeValueCollection.insert(value);
      }
    });
    persistencePromises.push(transaction.commit());
  }

  if (updates.length > 0) {
    const transaction = createTransaction<TCompanyAttributeValue>({
      autoCommit: false,
      mutationFn: ({ transaction }) =>
        Promise.all(
          transaction.mutations.map(({ modified: value }) =>
            fetchRpc((rpc) =>
              rpc.CompanyAttributeValueUpsert({
                id: value.id,
                attributeId: value.attributeId,
                companyId: value.companyId,
                organizationId: value.organizationId,
                value: getAttributeValue(value),
              })
            )
          )
        ),
    });
    transaction.mutate(() => {
      for (const { existingValue, valueColumns } of updates) {
        companyAttributeValueCollection.update(existingValue.id, (draft) => {
          Object.assign(draft, valueColumns, { updatedAt: new Date() });
        });
      }
    });
    persistencePromises.push(transaction.commit());
  }

  await Promise.all(persistencePromises);
}

function defaultInputValue(definition: CustomAttributeDefinition) {
  return definition.type === "BOOLEAN" ? false : "";
}

function inputType(type: CustomAttributeDefinition["type"]) {
  switch (type) {
    case "DATE":
      return "date";
    case "DECIMAL":
    case "INTEGER":
      return "number";
    default:
      return "text";
  }
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getAttributeValue(value: CustomAttributeValue): AttributeValueUpsert {
  return (
    value.valueText ??
    value.valueInteger ??
    value.valueDecimal ??
    value.valueBoolean ??
    value.valueDate
  );
}
