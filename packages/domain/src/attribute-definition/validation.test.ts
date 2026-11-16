import { describe, expect, it } from "vitest";

import {
  isPotentiallyUnsafeRegex,
  validateAttributeValue,
  type AttributeDefinition,
} from "./validation";

const storedAt = new Date(0);

/**
 * A stored definition. `type` is a plain string on purpose: the columns are
 * plain text (see `@feeblo/domain-contracts/attribute-type`), so a row can
 * carry a type this build's vocabulary does not contain.
 */
const definitionOfType = (type: string): AttributeDefinition => ({
  config: null,
  createdAt: storedAt,
  description: null,
  id: "contact-size",
  isRequired: false,
  key: "size",
  name: "Size",
  organizationId: "org-1",
  // SAFETY: the stored type is whatever the row holds; see this fixture's comment.
  type: type as AttributeDefinition["type"],
  updatedAt: storedAt,
});

describe("validateAttributeValue", () => {
  it("accepts a value that matches its definition", () => {
    expect(validateAttributeValue(definitionOfType("TEXT"), "large")).toEqual({
      valid: true,
    });
  });

  it("rejects a value of the wrong type", () => {
    expect(
      validateAttributeValue(definitionOfType("INTEGER"), "large")
    ).toEqual({
      valid: false,
      error: "Expected integer value for Size",
    });
  });

  it("rejects a stored type this build does not know instead of throwing", () => {
    expect(validateAttributeValue(definitionOfType("DURATION"), "5s")).toEqual({
      valid: false,
      error: "Expected duration value for Size",
    });
  });
});

describe("isPotentiallyUnsafeRegex", () => {
  it("rejects quantified ambiguous alternatives", () => {
    expect(isPotentiallyUnsafeRegex("^(a|aa)+$")).toBe(true);
  });

  it("allows a bounded attribute pattern", () => {
    expect(isPotentiallyUnsafeRegex("^[A-Z]{3}$")).toBe(false);
  });
});
