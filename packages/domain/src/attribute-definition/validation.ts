import type { schema } from "@feeblo/db";
import { isBoolean, isNumber, isString } from "@feeblo/utils/runtime-kind";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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

type ConfigValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly error: string };

type AttributeConfigValue = S.Schema.Type<typeof AttributeConfig>;

/** One attribute type's value check and its own config checks. */
type AttributeTypeRules = {
  /** Whether a non-null value has this type's runtime shape. */
  readonly accepts: (value: AttributeValue) => boolean;
  /** The type's configured-rule check; absent when the type has none. */
  readonly checkConfig?: AttributeConfigCheck;
};

type AttributeConfigCheck = (input: {
  readonly config: AttributeConfigValue;
  readonly definition: AttributeDefinition;
  readonly value: AttributeValue;
}) => ConfigValidationResult;

/** TEXT: an optional pattern, compiled only after the safety check. */
const checkTextConfig: AttributeConfigCheck = ({
  config,
  definition,
  value,
}) => {
  if (!isString(value)) {
    return {
      valid: false,
      error: `Expected text value for "${definition.name}"`,
    };
  }

  if (config.pattern === undefined) {
    return { valid: true };
  }

  if (isPotentiallyUnsafeRegex(config.pattern)) {
    // Never execute a pattern that can backtrack catastrophically;
    // fail loudly so the misconfiguration surfaces instead.
    return {
      valid: false,
      error: `Configured validation pattern for "${definition.name}" is unsafe and was not applied`,
    };
  }

  try {
    return new RegExp(config.pattern).test(value)
      ? { valid: true }
      : {
          valid: false,
          error: `Value for "${definition.name}" does not match configured rules`,
        };
  } catch {
    return {
      valid: false,
      error: `Configured validation pattern for "${definition.name}" is invalid`,
    };
  }
};

/** INTEGER and DECIMAL share one optional range. */
const checkNumericConfig: AttributeConfigCheck = ({
  config,
  definition,
  value,
}) => {
  if (!isNumber(value)) {
    return {
      valid: false,
      error: `Expected numeric value for "${definition.name}"`,
    };
  }

  if (config.min !== undefined && value < config.min) {
    return {
      valid: false,
      error: `Value for "${definition.name}" is below the configured minimum`,
    };
  }

  if (config.max !== undefined && value > config.max) {
    return {
      valid: false,
      error: `Value for "${definition.name}" exceeds the configured maximum`,
    };
  }

  return { valid: true };
};

/**
 * One entry per attribute type: how a value is type-checked and which
 * configured rules apply. A new type is one entry here rather than a new case
 * in the two switches that used to answer these questions separately.
 */
const attributeTypeRules: Record<
  AttributeDefinition["type"],
  AttributeTypeRules
> = {
  BOOLEAN: { accepts: isBoolean },
  DATE: {
    accepts: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
  },
  DECIMAL: {
    accepts: (value) => isNumber(value) && !Number.isNaN(value),
    checkConfig: checkNumericConfig,
  },
  INTEGER: {
    accepts: (value) => isNumber(value) && Number.isInteger(value),
    checkConfig: checkNumericConfig,
  },
  TEXT: { accepts: isString, checkConfig: checkTextConfig },
};

const validateType = (
  definition: AttributeDefinition,
  value: AttributeValue
): boolean => {
  if (value === null || value === undefined) {
    return !definition.isRequired;
  }

  return attributeTypeRules[definition.type].accepts(value);
};

const validateConfig = (
  definition: AttributeDefinition,
  value: AttributeValue
): ConfigValidationResult => {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  // `decodeUnknownOption`, not `decodeUnknownSync`: the stored configuration
  // comes from the database, and a row that no longer matches `AttributeConfig`
  // is a misconfiguration, not a caller error. Throwing here would surface as
  // an Effect defect — bypassing the `BadRequestError` channel
  // `validateAttributeValueEffect` declares — instead of the validation failure
  // the other misconfiguration branches already return.
  const decodedConfig = S.decodeOption(AttributeConfig)(
    definition.config ?? {},
    { onExcessProperty: "ignore" }
  );

  if (Option.isNone(decodedConfig)) {
    return {
      valid: false,
      error: `Configured validation rules for "${definition.name}" are invalid`,
    };
  }

  const { checkConfig } = attributeTypeRules[definition.type];

  return (
    checkConfig?.({ config: decodedConfig.value, definition, value }) ?? {
      valid: true,
    }
  );
};

export type AttributeValidationResult = {
  valid: boolean;
  error?: string;
};

export const validateAttributeValue = (
  definition: AttributeDefinition,
  value: AttributeValue
): AttributeValidationResult => {
  if (!validateType(definition, value)) {
    return {
      valid: false,
      error: `Expected ${definition.type.toLowerCase()} value for ${definition.name}`,
    };
  }

  const configResult = validateConfig(definition, value);

  if (!configResult.valid) {
    return {
      valid: false,
      error: configResult.error,
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

/**
 * Maximum length of an attribute validation pattern. Long patterns are never
 * needed for field validation and keep the compiled-regex surface small.
 */
export const MAX_ATTRIBUTE_PATTERN_LENGTH = 200;

const MAX_ATTRIBUTE_PATTERN_REPETITION = 100;

/** A single decimal digit, the only backreference number a pattern may carry. */
const singleDigitPattern = /^[0-9]$/;

/** A repetition bound, which must be a plain decimal integer. */
const decimalIntegerPattern = /^\d+$/;

/**
 * Rejects regular expressions that are prone to catastrophic backtracking
 * (ReDoS). Attribute patterns are compiled and executed against values that
 * can originate from untrusted input (e.g. widget SSO JWT attribute payloads),
 * so a pathological pattern such as `(a+)+$` must never be executed.
 *
 * Attribute patterns use a deliberately non-backtracking subset of JavaScript
 * regular expressions: literals, character classes, anchors, escapes, and
 * bounded repetitions. Groups, alternatives, and unbounded quantifiers are
 * rejected, which rules out both nested-quantifier and ambiguous-alternative
 * ReDoS shapes such as `(a+)+` and `(a|aa)+`.
 */
export const isPotentiallyUnsafeRegex = (pattern: string): boolean => {
  if (pattern.length > MAX_ATTRIBUTE_PATTERN_LENGTH) {
    return true;
  }

  let inCharClass = false;
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "\\") {
      // Backreferences make matching non-regular and can introduce expensive
      // retry paths. Escaped literals and character classes remain safe.
      if (singleDigitPattern.test(pattern[i + 1] ?? "")) {
        return true;
      }

      i += 2;
      continue;
    }

    if (inCharClass) {
      if (ch === "]") {
        inCharClass = false;
      }

      i += 1;
      continue;
    }

    if (ch === "[") {
      inCharClass = true;
      i += 1;
      continue;
    }

    if (ch === "{") {
      const end = pattern.indexOf("}", i + 1);
      const repetition = pattern.slice(i + 1, end);
      const repetitionParts = repetition.split(",");

      if (
        end === -1 ||
        repetitionParts.length > 2 ||
        repetitionParts.some((part) => !decimalIntegerPattern.test(part)) ||
        repetitionParts.some(
          (part) => Number(part) > MAX_ATTRIBUTE_PATTERN_REPETITION
        )
      ) {
        return true;
      }

      i = end + 1;
      continue;
    }

    if (
      ch === "(" ||
      ch === ")" ||
      ch === "|" ||
      ch === "*" ||
      ch === "+" ||
      ch === "?"
    ) {
      return true;
    }

    i += 1;
  }

  return false;
};

export const noDuplicateAttributeIds = S.makeFilter<
  readonly { readonly attributeId: string }[]
>((attributeValues) => {
  const attributeIds = new Set<string>();

  for (const { attributeId } of attributeValues) {
    if (attributeIds.has(attributeId)) {
      return "attributeValues must not contain duplicate attributeId values";
    }

    attributeIds.add(attributeId);
  }

  return true;
});
