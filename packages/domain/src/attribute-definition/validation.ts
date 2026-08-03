import type { schema } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { BadRequestError } from "../rpc-errors";
import { AttributeConfig } from "./schema";

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
      if (config.pattern === undefined) {
        return true;
      }
      try {
        return new RegExp(config.pattern).test(value);
      } catch {
        return true;
      }
    }
    case "INTEGER":
    case "DECIMAL": {
      if (typeof value !== "number") {
        return false;
      }
      if (config.min !== undefined && value < config.min) {
        return false;
      }
      return !(config.max !== undefined && value > config.max);
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

/**
 * Validates an attribute value against its definition and fails with a
 * BadRequestError when the value does not match the definition's type or
 * configured rules (min/max/pattern) or when a required value is missing.
 */
export const validateAttributeValueEffect = (
  definition: AttributeDefinition,
  value: AttributeValue
): Effect.Effect<void, BadRequestError> =>
  Effect.gen(function* () {
    const result = validateAttributeValue(definition, value);
    if (!result.valid) {
      return yield* new BadRequestError({ message: result.error });
    }
  });
