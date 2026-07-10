import type { schema } from "@feeblo/db";
import * as S from "effect/Schema";

export type AttributeDefinition =
  | typeof schema.contactAttributeDefinitionTable.$inferSelect
  | typeof schema.companyAttributeDefinitionTable.$inferSelect;

export type AttributeValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

const AttributeConfig = S.Struct({
  min: S.optional(S.Number),
  max: S.optional(S.Number),
  pattern: S.optional(S.String),
});

const validateType = (
  definition: AttributeDefinition,
  value: AttributeValue
): boolean => {
  if (value === null || value === undefined) {
    return !definition.isRequired;
  }

  switch (definition.type) {
    case "TEXT":
      return typeof value === "string";
    case "INTEGER":
      return typeof value === "number" && Number.isInteger(value);
    case "DECIMAL":
      return typeof value === "number" && !Number.isNaN(value);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "DATE":
      return value instanceof Date && !Number.isNaN(value.getTime());
    default:
      return false;
  }
};

const validateConfig = (
  definition: AttributeDefinition,
  value: AttributeValue
): boolean => {
  if (value === null || value === undefined) {
    return true;
  }

  const config = S.decodeUnknownSync(AttributeConfig)(definition.config ?? {}, {
    onExcessProperty: "ignore",
  });

  switch (definition.type) {
    case "TEXT": {
      if (typeof value !== "string") {
        return false;
      }
      if (config.pattern && !new RegExp(config.pattern).test(value)) {
        return false;
      }
      return true;
    }
    case "INTEGER":
    case "DECIMAL": {
      if (typeof value !== "number") {
        return false;
      }
      if (config.min !== undefined && value < config.min) {
        return false;
      }
      if (config.max !== undefined && value > config.max) {
        return false;
      }
      return true;
    }
    default:
      return true;
  }
};

export const validateAttributeValue = (
  definition: AttributeDefinition,
  value: AttributeValue
): { valid: boolean; error?: string } => {
  if (!validateType(definition, value)) {
    return {
      valid: false,
      error: `Expected ${definition.type.toLowerCase()} value for ${definition.name}`,
    };
  }

  if (!validateConfig(definition, value)) {
    return {
      valid: false,
      error: `Value for ${definition.name} does not match configured rules`,
    };
  }

  return { valid: true };
};
