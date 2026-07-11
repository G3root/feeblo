import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { DataValidationError } from "./errors";
import type {
  TCommonCompanyFields,
  TCommonContactFields,
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "./schema";
import {
  AttributeConfig,
  CommonCompanyFields,
  CommonContactFields,
} from "./schema";

export type AttributeValue = string | number | boolean | Date | null;

export const AttributeValueColumns = S.Struct({
  valueText: S.NullOr(S.String),
  valueInteger: S.NullOr(S.Number),
  valueDecimal: S.NullOr(S.Number),
  valueBoolean: S.NullOr(S.Boolean),
  valueDate: S.NullOr(S.Date),
});

export type AttributeValueColumns = S.Schema.Type<typeof AttributeValueColumns>;

export function buildAttributeValueColumns(
  value: AttributeValue | undefined
): AttributeValueColumns {
  if (value === null || value === undefined) {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    };
  }

  if (typeof value === "string") {
    return {
      valueText: value,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    };
  }

  if (typeof value === "boolean") {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: value,
      valueDate: null,
    };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return {
        valueText: null,
        valueInteger: value,
        valueDecimal: null,
        valueBoolean: null,
        valueDate: null,
      };
    }
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: value,
      valueBoolean: null,
      valueDate: null,
    };
  }

  return {
    valueText: null,
    valueInteger: null,
    valueDecimal: null,
    valueBoolean: null,
    valueDate: value,
  };
}

export function toMutableConfig(
  config: Record<string, unknown> | undefined | null
): { min?: number; max?: number; pattern?: string } | null {
  if (config === null || config === undefined) {
    return null;
  }
  return S.decodeUnknownSync(AttributeConfig)(config, {
    onExcessProperty: "ignore",
  }) as { min?: number; max?: number; pattern?: string };
}

export type ParsedAttribute = {
  definitionId: string;
  key: string;
  value: AttributeValue;
};

export type ParsedCompanyAttributes = {
  commonFields: TCommonCompanyFields;
  customAttributes: ParsedAttribute[];
};

export type ParsedPersonAttributes = {
  commonFields: TCommonContactFields;
  customAttributes: ParsedAttribute[];
  companies: ParsedCompanyAttributes[];
};

const KNOWN_CONTACT_FIELDS = new Set([
  "userId",
  "email",
  "name",
  "companies",
  "profilePicture",
  "tags",
  "locale",
]);

const KNOWN_COMPANY_FIELDS = new Set([
  "id",
  "name",
  "monthlySpend",
  "createdAt",
]);

type AttributeDefinition =
  | TContactAttributeDefinition
  | TCompanyAttributeDefinition;

const valueSchemaForDefinition = (
  definition: AttributeDefinition
): S.Codec<AttributeValue> => {
  switch (definition.type) {
    case "TEXT": {
      let schema: S.Codec<string> = S.String;
      const pattern = definition.config?.pattern;
      if (pattern !== undefined) {
        schema = schema.check(
          S.isPattern(new RegExp(pattern), {
            message: `must match pattern "${pattern}"`,
          })
        );
      }
      return schema as unknown as S.Codec<AttributeValue>;
    }
    case "INTEGER": {
      let schema: S.Codec<number> = S.Number.check(
        S.isInt({ message: "must be an integer" })
      );
      const min = definition.config?.min;
      if (min !== undefined) {
        schema = schema.check(
          S.isGreaterThanOrEqualTo(min, {
            message: `must be greater than or equal to ${min}`,
          })
        );
      }
      const max = definition.config?.max;
      if (max !== undefined) {
        schema = schema.check(
          S.isLessThanOrEqualTo(max, {
            message: `must be less than or equal to ${max}`,
          })
        );
      }
      return schema as unknown as S.Codec<AttributeValue>;
    }
    case "DECIMAL": {
      let schema: S.Codec<number> = S.Number.check(
        S.isFinite({ message: "must be a finite number" })
      );
      const min = definition.config?.min;
      if (min !== undefined) {
        schema = schema.check(
          S.isGreaterThanOrEqualTo(min, {
            message: `must be greater than or equal to ${min}`,
          })
        );
      }
      const max = definition.config?.max;
      if (max !== undefined) {
        schema = schema.check(
          S.isLessThanOrEqualTo(max, {
            message: `must be less than or equal to ${max}`,
          })
        );
      }
      return schema as unknown as S.Codec<AttributeValue>;
    }
    case "BOOLEAN": {
      return S.Boolean as unknown as S.Codec<AttributeValue>;
    }
    case "DATE": {
      return S.Union([S.Date, S.DateFromString]).check(
        S.isDateValid({ message: "must be a valid date" })
      ) as unknown as S.Codec<AttributeValue>;
    }
    default: {
      return S.Never as unknown as S.Codec<AttributeValue>;
    }
  }
};

const validateSingleAttribute = (
  definition: AttributeDefinition,
  raw: unknown
): Effect.Effect<AttributeValue, DataValidationError> =>
  Effect.gen(function* () {
    if (raw === null || raw === undefined) {
      if (definition.isRequired) {
        return yield* new DataValidationError({
          message: `Missing required attribute "${definition.key}"`,
        });
      }
      return null;
    }

    const schema = valueSchemaForDefinition(definition);
    return yield* S.decodeUnknownEffect(schema)(raw).pipe(
      Effect.mapError(
        (error: S.SchemaError) =>
          new DataValidationError({
            message: `Invalid value for attribute "${definition.key}": ${error.message}`,
          })
      )
    );
  });

const validateRequiredAttributes = (
  definitions: readonly AttributeDefinition[],
  data: Record<string, unknown>
): Effect.Effect<void, DataValidationError> => {
  const missing = definitions
    .filter((d) => d.isRequired && !(d.key in data))
    .map((d) => `Missing required attribute "${d.key}"`);
  return missing.length > 0
    ? Effect.fail(new DataValidationError({ message: missing.join("; ") }))
    : Effect.void;
};

const parseCustomAttributes = (
  data: Record<string, unknown>,
  definitions: readonly AttributeDefinition[],
  knownFields: ReadonlySet<string>
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  Effect.gen(function* () {
    yield* validateRequiredAttributes(definitions, data);

    const defMap = new Map(definitions.map((d) => [d.key, d]));
    const effects: Effect.Effect<ParsedAttribute, DataValidationError>[] = [];

    for (const [key, raw] of Object.entries(data)) {
      if (knownFields.has(key)) {
        continue;
      }
      const definition = defMap.get(key);
      if (!definition) {
        continue;
      }
      effects.push(
        validateSingleAttribute(definition, raw).pipe(
          Effect.map(
            (value): ParsedAttribute => ({
              definitionId: definition.id,
              key: definition.key,
              value,
            })
          )
        )
      );
    }

    return effects.length > 0
      ? yield* Effect.all(effects, { concurrency: "unbounded" })
      : [];
  });

export const parseContactCustomAttributes = (
  data: Record<string, unknown>,
  definitions: readonly TContactAttributeDefinition[]
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  parseCustomAttributes(data, definitions, KNOWN_CONTACT_FIELDS);

export const parseCompanyCustomAttributes = (
  data: Record<string, unknown>,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  parseCustomAttributes(data, definitions, KNOWN_COMPANY_FIELDS);

const decodeCommonFields = <A>(
  schema: S.Codec<A>,
  kind: string,
  fields: Record<string, unknown>
): Effect.Effect<A, DataValidationError> =>
  S.decodeUnknownEffect(schema)(fields, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      (error: S.SchemaError) =>
        new DataValidationError({
          message: `Invalid ${kind} fields: ${error.message}`,
        })
    )
  );

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

const parseSingleCompany = (
  raw: unknown,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedCompanyAttributes, DataValidationError> =>
  Effect.gen(function* () {
    const input = asRecord(raw);

    const commonFields = yield* decodeCommonFields(
      CommonCompanyFields,
      "company",
      { id: input.id, name: input.name }
    );

    const customAttributes = yield* parseCompanyCustomAttributes(
      input,
      definitions
    );

    return { commonFields, customAttributes };
  });

const parseCompanies = (
  companies: unknown,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedCompanyAttributes[], DataValidationError> =>
  Array.isArray(companies) && companies.length > 0
    ? Effect.all(
        companies.map((company) => parseSingleCompany(company, definitions)),
        { concurrency: "unbounded" }
      )
    : Effect.succeed([]);

export function parsePersonAttributes(
  data: unknown,
  contactAttributeDefinitions: readonly TContactAttributeDefinition[],
  companyAttributeDefinitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedPersonAttributes, DataValidationError> {
  return Effect.gen(function* () {
    const input = asRecord(data);

    const commonFields = yield* decodeCommonFields(
      CommonContactFields,
      "contact",
      { userId: input.userId, email: input.email, name: input.name }
    );

    const [customAttributes, companies] = yield* Effect.all(
      [
        parseContactCustomAttributes(input, contactAttributeDefinitions),
        parseCompanies(input.companies, companyAttributeDefinitions),
      ],
      { concurrency: 2 }
    );

    return { commonFields, customAttributes, companies };
  });
}
