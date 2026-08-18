import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import type { JWTPayload } from "jose";

import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../attribute-definition/schema";
import { AttributeConfig } from "../attribute-definition/schema";
import { isPotentiallyUnsafeRegex } from "../attribute-definition/validation";
import type { TCommonCompanyFields } from "../company/schema";
import { CommonCompanyFields } from "../company/schema";
import { DataValidationError } from "./errors";
import type { TCommonContactFields } from "./schema";
import { CommonContactFields } from "./schema";

export type AttributeValue = string | number | boolean | Date | null;

/** Untrusted identity-token payload: arbitrary claims plus the standard fields. */
export interface AttributeSource {
  readonly [key: string]: AttributeSourceValue;
}

/** Value space of untrusted identity-token payloads (JSON-ish, no class instances). */
export type AttributeSourceValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JWTPayload
  | AttributeSource
  | readonly AttributeSource[];

export const AttributeValueColumns = S.Struct({
  valueText: S.NullOr(S.String),
  valueInteger: S.NullOr(S.Number),
  valueDecimal: S.NullOr(S.Number),
  valueBoolean: S.NullOr(S.Boolean),
  valueDate: S.NullOr(S.Date),
});

export type AttributeValueColumns = S.Schema.Type<typeof AttributeValueColumns>;

const isStringValue = (value: AttributeSourceValue): value is string =>
  Object(value) instanceof String;
const isBooleanValue = (value: AttributeSourceValue): value is boolean =>
  Object(value) instanceof Boolean;

// SAFETY: the prototype of a boxed primitive exactly mirrors its type, so
// the narrowed view below is sound for every AttributeSourceValue.
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

  if (value instanceof Date) {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: value,
    };
  }

  if (isStringValue(value)) {
    return {
      valueText: value,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    };
  }

  if (isBooleanValue(value)) {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: value,
      valueDate: null,
    };
  }

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

/** Source object accepted by `toMutableConfig` before schema validation. */
export type AttributeConfigSource = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export function toMutableConfig(
  config: AttributeConfigSource | undefined | null
): S.Schema.Type<typeof AttributeConfig> | null {
  if (config === null || config === undefined) {
    return null;
  }
  return S.decodeUnknownSync(AttributeConfig)(config, {
    onExcessProperty: "ignore",
  });
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
  "avatar",
  "companies",
  "customFields",
]);

/** A regex that never matches, used to reject values when a configured pattern is unsafe. */
const UNSAFE_PATTERN_NEVER_MATCHES = /.^/;

const KNOWN_COMPANY_FIELDS = new Set([
  "id",
  "name",
  "avatar",
  "createdAt",
  "customFields",
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
        if (isPotentiallyUnsafeRegex(pattern)) {
          // A catastrophic pattern must never be executed against values that
          // can originate from untrusted JWT payloads. Reject values with a
          // clear error instead so the misconfiguration surfaces.
          schema = schema.check(
            S.isPattern(UNSAFE_PATTERN_NEVER_MATCHES, {
              message: "configured validation pattern is unsafe",
            })
          );
        } else {
          let expression: RegExp;
          try {
            expression = new RegExp(pattern);
          } catch {
            schema = schema.check(
              S.isPattern(UNSAFE_PATTERN_NEVER_MATCHES, {
                message: `configured validation pattern "${pattern}" is invalid`,
              })
            );
            // SAFETY: the checked schema still decodes to `string`, which is a
            // member of AttributeValue, so the widening is lossless.
            return schema as S.Codec<AttributeValue>;
          }
          schema = schema.check(
            S.isPattern(expression, {
              message: `must match pattern "${pattern}"`,
            })
          );
        }
      }
      // SAFETY: the checked schema still decodes to `string`, which is a
      // member of AttributeValue, so the widening is lossless.
      return schema as S.Codec<AttributeValue>;
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
      // SAFETY: the result decodes to `number`, a member of AttributeValue.
      return schema as S.Codec<AttributeValue>;
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
      // SAFETY: the result decodes to `number`, a member of AttributeValue.
      return schema as S.Codec<AttributeValue>;
    }
    case "BOOLEAN": {
      // SAFETY: the result decodes to `boolean`, a member of AttributeValue.
      return S.Boolean as S.Codec<AttributeValue>;
    }
    case "DATE": {
      // S.Date already rejects NaN/invalid Date instances, and S.DateFromString
      // fails to decode garbage strings into a valid date, so no extra
      // validity filter is needed.
      // SAFETY: both members decode to `Date`, a member of AttributeValue.
      return S.Union([S.Date, S.DateFromString]) as S.Codec<AttributeValue>;
    }
    default: {
      // SAFETY: Never rejects every value, so any target type is sound.
      return S.Never as S.Codec<AttributeValue>;
    }
  }
};

const validateSingleAttribute = (
  definition: AttributeDefinition,
  raw: AttributeSourceValue
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
  data: AttributeSource
): Effect.Effect<void, DataValidationError> => {
  const missing = definitions
    .filter((d) => d.isRequired && !(d.key in data))
    .map((d) => `Missing required attribute "${d.key}"`);
  return missing.length > 0
    ? Effect.fail(new DataValidationError({ message: missing.join("; ") }))
    : Effect.void;
};

const parseCustomAttributes = (
  customFields: AttributeSource,
  definitions: readonly AttributeDefinition[],
  knownFields: ReadonlySet<string>
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  Effect.gen(function* () {
    yield* validateRequiredAttributes(definitions, customFields);

    const defMap = new Map(definitions.map((d) => [d.key, d]));
    const effects: Effect.Effect<ParsedAttribute, DataValidationError>[] = [];

    for (const [key, raw] of Object.entries(customFields)) {
      if (knownFields.has(key)) {
        continue;
      }
      const definition = defMap.get(key);
      if (!definition) {
        continue;
      }
      effects.push(
        validateSingleAttribute(definition, raw).pipe(
          Effect.map((value): ParsedAttribute => ({
            definitionId: definition.id,
            key: definition.key,
            value,
          }))
        )
      );
    }

    return effects.length > 0
      ? yield* Effect.all(effects, { concurrency: "unbounded" })
      : [];
  });

export const parseContactCustomAttributes = (
  data: JWTPayload,
  definitions: readonly TContactAttributeDefinition[]
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  parseCustomAttributes(
    // SAFETY: token claims are untrusted; asRecord validates the shape and
    // falls back to `{}` for anything that is not a plain object.
    asRecord(data.customFields as AttributeSourceValue),
    definitions,
    KNOWN_CONTACT_FIELDS
  );

export const parseCompanyCustomAttributes = (
  data: JWTPayload,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedAttribute[], DataValidationError> =>
  parseCustomAttributes(
    // SAFETY: token claims are untrusted; asRecord validates the shape and
    // falls back to `{}` for anything that is not a plain object.
    asRecord(data.customFields as AttributeSourceValue),
    definitions,
    KNOWN_COMPANY_FIELDS
  );

const decodeCommonFields = <A>(
  schema: S.Codec<A, any, never, never>,
  kind: string,
  fields: AttributeSource
): Effect.Effect<A, DataValidationError> =>
  S.decodeUnknownEffect(schema)(fields, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      (error: S.SchemaError) =>
        new DataValidationError({
          message: `Invalid ${kind} fields: ${error.message}`,
        })
    )
  );

const asRecord = (
  raw: AttributeSourceValue | null | undefined
): AttributeSource => {
  if (
    raw !== null &&
    raw !== undefined &&
    !Array.isArray(raw) &&
    Object.getPrototypeOf(Object(raw)) === Object.prototype
  ) {
    // SAFETY: the checks above establish that `raw` is a non-array plain
    // object, which is exactly the AttributeSource contract its callers read.
    return raw as AttributeSource;
  }
  return {};
};

const parseSingleCompany = (
  raw: AttributeSourceValue,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedCompanyAttributes, DataValidationError> =>
  Effect.gen(function* () {
    const input = asRecord(raw);

    const commonFields = yield* decodeCommonFields(
      CommonCompanyFields,
      "company",
      {
        id: input.id,
        name: input.name,
        avatar: input.avatar,
        externalCreatedAt: input.createdAt,
      }
    );

    const customAttributes = yield* parseCompanyCustomAttributes(
      input,
      definitions
    );

    return { commonFields, customAttributes };
  });

const parseCompanies = (
  companies: AttributeSourceValue,
  definitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedCompanyAttributes[], DataValidationError> =>
  Array.isArray(companies) && companies.length > 0
    ? Effect.all(
        companies.map((company) => parseSingleCompany(company, definitions)),
        { concurrency: "unbounded" }
      )
    : Effect.succeed([]);

export function parsePersonAttributes(
  data: JWTPayload | null,
  contactAttributeDefinitions: readonly TContactAttributeDefinition[],
  companyAttributeDefinitions: readonly TCompanyAttributeDefinition[]
): Effect.Effect<ParsedPersonAttributes, DataValidationError> {
  return Effect.gen(function* () {
    const input = asRecord(data);

    const commonFields = yield* decodeCommonFields(
      CommonContactFields,
      "contact",
      {
        userId: input.userId,
        email: input.email,
        name: input.name,
        avatar: input.avatar,
      }
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
