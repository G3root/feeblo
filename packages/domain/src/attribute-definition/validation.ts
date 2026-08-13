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

type ConfigValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly error: string };

const validateConfig = (
  definition: AttributeDefinition,
  value: AttributeValue
): ConfigValidationResult => {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  const config = S.decodeUnknownSync(AttributeConfig)(definition.config ?? {}, {
    onExcessProperty: "ignore",
  });

  switch (definition.type) {
    case "TEXT": {
      if (typeof value !== "string") {
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
    }
    case "INTEGER":
    case "DECIMAL": {
      if (typeof value !== "number") {
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
    }
    default:
      return { valid: true };
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

/** Matches a `{n}`, `{n,}`, or `{n,m}` repetition specifier. */
const REPETITION = /^\{[0-9]+(?:,[0-9]*)?\}/;

/**
 * Whether a repetition specifier can repeat its target an unbounded number of
 * times (the `{n,}` form). Bounded repetitions cannot cause exponential
 * backtracking on their own.
 */
const isUnboundedRepetition = (specifier: string): boolean => {
  const body = specifier.slice(1, -1);
  return body.includes(",") && body.endsWith(",");
};

/**
 * Whether the character at `index` begins a quantifier that can repeat its
 * target an unbounded number of times: `*`, `+`, or `{n,}`. `?` (at most one
 * match) and bounded `{n}` / `{n,m}` repetitions are not unbounded.
 */
const isUnboundedQuantifierAt = (pattern: string, index: number): boolean => {
  const ch = pattern[index];
  if (ch === "*" || ch === "+") {
    return true;
  }
  if (ch === "{") {
    const match = REPETITION.exec(pattern.slice(index));
    return match !== null && isUnboundedRepetition(match[0]);
  }
  return false;
};

/**
 * Rejects regular expressions that are prone to catastrophic backtracking
 * (ReDoS). Attribute patterns are compiled and executed against values that
 * can originate from untrusted input (e.g. widget SSO JWT attribute payloads),
 * so a pathological pattern such as `(a+)+$` must never be executed.
 *
 * The check is a conservative heuristic: it rejects patterns longer than
 * {@link MAX_ATTRIBUTE_PATTERN_LENGTH} and any quantified group whose contents
 * already contain a repetition quantifier and that is itself quantified by an
 * unbounded quantifier (`*`, `+`, or `{n,}`) — the classic nested-quantifier
 * shape behind most ReDoS. Bounded (`{n}`, `{n,m}`) and optional (`?`)
 * quantifiers are tolerated because they cannot repeat an unbounded number of
 * times.
 */
export const isPotentiallyUnsafeRegex = (pattern: string): boolean => {
  if (pattern.length > MAX_ATTRIBUTE_PATTERN_LENGTH) {
    return true;
  }

  // Per open group, whether a repetition quantifier appeared inside it. When
  // such a group is itself quantified (`(a+)+`, `(a*)*`, `(?:a?)+`, `(a+){2,}`),
  // matching can exhibit exponential backtracking.
  const groups: boolean[] = [];
  let inCharClass = false;
  let escaped = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      i += 1;
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
    if (ch === "(") {
      groups.push(false);
      i += 1;
      continue;
    }
    if (ch === ")") {
      const containedQuantifier = groups.pop() ?? false;
      if (containedQuantifier && isUnboundedQuantifierAt(pattern, i + 1)) {
        return true;
      }
      i += 1;
      continue;
    }
    if (ch === "{") {
      const match = REPETITION.exec(pattern.slice(i));
      if (match !== null) {
        if (isUnboundedRepetition(match[0]) && groups.length > 0) {
          groups[groups.length - 1] = true;
        }
        i += match[0].length;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "?" || ch === "*" || ch === "+") {
      // `(?` starts a group modifier (`?:`, `?=`, `?!`, `?<=`, `?<!`), not a
      // quantifier.
      if (ch === "?" && pattern[i - 1] === "(") {
        i += 1;
        continue;
      }
      if (groups.length > 0) {
        groups[groups.length - 1] = true;
      }
      i += 1;
      continue;
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
