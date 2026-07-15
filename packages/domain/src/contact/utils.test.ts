import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../attribute-definition/schema";
import { DataValidationError } from "./errors";
import {
  buildAttributeValueColumns,
  parseCompanyCustomAttributes,
  parseContactCustomAttributes,
  parsePersonAttributes,
  toMutableConfig,
} from "./utils";

const now = new Date();

function makeContactDef(
  overrides: Partial<TContactAttributeDefinition> = {}
): TContactAttributeDefinition {
  return {
    id: "cad_def1" as any,
    name: "Test Attr",
    key: "customField",
    description: "A test attribute",
    type: "TEXT",
    config: null,
    isRequired: false,
    organizationId: "org_1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCompanyDef(
  overrides: Partial<TCompanyAttributeDefinition> = {}
): TCompanyAttributeDefinition {
  return {
    id: "cmp_def1" as any,
    name: "Test Company Attr",
    key: "companyCustom",
    description: "A test company attribute",
    type: "TEXT",
    config: null,
    isRequired: false,
    organizationId: "org_1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildAttributeValueColumns", () => {
  it("returns all nulls for null value", () => {
    expect(buildAttributeValueColumns(null)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("returns all nulls for undefined value", () => {
    expect(buildAttributeValueColumns(undefined)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("maps string to valueText", () => {
    expect(buildAttributeValueColumns("hello")).toEqual({
      valueText: "hello",
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("maps boolean true to valueBoolean", () => {
    expect(buildAttributeValueColumns(true)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: true,
      valueDate: null,
    });
  });

  it("maps boolean false to valueBoolean", () => {
    expect(buildAttributeValueColumns(false)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: false,
      valueDate: null,
    });
  });

  it("maps integer to valueInteger", () => {
    expect(buildAttributeValueColumns(42)).toEqual({
      valueText: null,
      valueInteger: 42,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("maps decimal to valueDecimal", () => {
    expect(buildAttributeValueColumns(3.14)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: 3.14,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("maps Date to valueDate", () => {
    const date = new Date("2024-01-01");
    expect(buildAttributeValueColumns(date)).toEqual({
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: date,
    });
  });

  it("maps empty string to valueText", () => {
    expect(buildAttributeValueColumns("")).toEqual({
      valueText: "",
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });

  it("maps zero integer to valueInteger", () => {
    expect(buildAttributeValueColumns(0)).toEqual({
      valueText: null,
      valueInteger: 0,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    });
  });
});

describe("toMutableConfig", () => {
  it("returns null for null input", () => {
    expect(toMutableConfig(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(toMutableConfig(undefined)).toBeNull();
  });

  it("parses a valid config with min and max", () => {
    expect(toMutableConfig({ min: 1, max: 10 })).toEqual({
      min: 1,
      max: 10,
    });
  });

  it("parses a config with pattern", () => {
    expect(toMutableConfig({ pattern: "^[a-z]+$" })).toEqual({
      pattern: "^[a-z]+$",
    });
  });

  it("parses an empty object", () => {
    expect(toMutableConfig({})).toEqual({});
  });

  it("ignores excess properties", () => {
    expect(toMutableConfig({ min: 5, max: 20, extra: "ignored" })).toEqual({
      min: 5,
      max: 20,
    });
  });

  it("throws for invalid config type", () => {
    expect(() => toMutableConfig({ min: "not-a-number" })).toThrow();
  });
});

describe("parseContactCustomAttributes", () => {
  it.effect("returns empty array for empty data and empty definitions", () =>
    Effect.gen(function* () {
      const result = yield* parseContactCustomAttributes({}, []);
      expect(result).toEqual([]);
    })
  );

  it.effect("skips known contact fields", () =>
    Effect.gen(function* () {
      const def = makeContactDef({ key: "email" });
      const result = yield* parseContactCustomAttributes(
        { customFields: { email: "test@test.com" } },
        [def]
      );
      expect(result).toEqual([]);
    })
  );

  it.effect("parses a custom TEXT attribute", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "customField",
        type: "TEXT",
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { customField: "hello" } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "customField", value: "hello" },
      ]);
    })
  );

  it.effect("skips unknown keys not in definitions", () =>
    Effect.gen(function* () {
      const result = yield* parseContactCustomAttributes(
        { customFields: { randomKey: "value" } },
        []
      );
      expect(result).toEqual([]);
    })
  );

  it("fails when required attribute is missing", async () => {
    const def = makeContactDef({
      key: "requiredField",
      isRequired: true,
    });
    try {
      await Effect.runPromise(parseContactCustomAttributes({}, [def]));
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      expect((error as DataValidationError).message).toContain(
        'Missing required attribute "requiredField"'
      );
    }
  });

  it("fails on invalid value for INTEGER attribute", async () => {
    const def = makeContactDef({
      key: "age",
      type: "INTEGER",
    });
    try {
      await Effect.runPromise(
        parseContactCustomAttributes(
          { customFields: { age: "not-a-number" } },
          [def]
        )
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      expect((error as DataValidationError).message).toContain(
        'Invalid value for attribute "age"'
      );
    }
  });

  it.effect("validates INTEGER attribute within min/max range", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "score",
        type: "INTEGER",
        config: { min: 1, max: 100 },
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { score: 50 } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "score", value: 50 },
      ]);
    })
  );

  it("fails when INTEGER is out of range", async () => {
    const def = makeContactDef({
      key: "score",
      type: "INTEGER",
      config: { min: 1, max: 100 },
    });
    try {
      await Effect.runPromise(
        parseContactCustomAttributes({ customFields: { score: 101 } }, [def])
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
    }
  });

  it.effect("parses a BOOLEAN attribute", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "subscribed",
        type: "BOOLEAN",
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { subscribed: true } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "subscribed", value: true },
      ]);
    })
  );

  it.effect("parses a DATE attribute from ISO string", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "birthday",
        type: "DATE",
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { birthday: "2024-01-15" } },
        [def]
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe("birthday");
      expect(result[0]?.value).toBeInstanceOf(Date);
    })
  );

  it.effect("allows null value for non-required attribute", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "optionalField",
        type: "TEXT",
        isRequired: false,
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { optionalField: null } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "optionalField", value: null },
      ]);
    })
  );

  it.effect("parses multiple custom attributes", () =>
    Effect.gen(function* () {
      const def1 = makeContactDef({ key: "city", type: "TEXT" });
      const def2 = makeContactDef({ key: "age", type: "INTEGER" });
      const result = yield* parseContactCustomAttributes(
        { customFields: { city: "Paris", age: 30 } },
        [def1, def2]
      );
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.key).sort()).toEqual(["age", "city"]);
    })
  );

  it.effect("validates TEXT pattern constraint", () =>
    Effect.gen(function* () {
      const def = makeContactDef({
        key: "code",
        type: "TEXT",
        config: { pattern: "^[A-Z]{3}$" },
      });
      const result = yield* parseContactCustomAttributes(
        { customFields: { code: "ABC" } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "code", value: "ABC" },
      ]);
    })
  );

  it("fails when TEXT does not match pattern", async () => {
    const def = makeContactDef({
      key: "code",
      type: "TEXT",
      config: { pattern: "^[A-Z]{3}$" },
    });
    try {
      await Effect.runPromise(
        parseContactCustomAttributes({ customFields: { code: "abc" } }, [def])
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
    }
  });
});

describe("parseCompanyCustomAttributes", () => {
  it.effect("returns empty array for empty data", () =>
    Effect.gen(function* () {
      const result = yield* parseCompanyCustomAttributes({}, []);
      expect(result).toEqual([]);
    })
  );

  it.effect("skips known company fields (id, name)", () =>
    Effect.gen(function* () {
      const def = makeCompanyDef({ key: "name" });
      const result = yield* parseCompanyCustomAttributes(
        { customFields: { id: "123", name: "Acme" } },
        [def]
      );
      expect(result).toEqual([]);
    })
  );

  it.effect("skips known company fields (avatar)", () =>
    Effect.gen(function* () {
      const def = makeCompanyDef({ key: "avatar" });
      const result = yield* parseCompanyCustomAttributes(
        { customFields: { avatar: "https://example.com/acme.png" } },
        [def]
      );
      expect(result).toEqual([]);
    })
  );

  it.effect("skips known company fields (createdAt)", () =>
    Effect.gen(function* () {
      const def = makeCompanyDef({ key: "createdAt" });
      const result = yield* parseCompanyCustomAttributes(
        { customFields: { createdAt: "2023-05-19T15:35:49.915Z" } },
        [def]
      );
      expect(result).toEqual([]);
    })
  );

  it.effect("parses a DECIMAL attribute", () =>
    Effect.gen(function* () {
      const def = makeCompanyDef({
        key: "revenue",
        type: "DECIMAL",
      });
      const result = yield* parseCompanyCustomAttributes(
        { customFields: { revenue: 99.99 } },
        [def]
      );
      expect(result).toEqual([
        { definitionId: def.id, key: "revenue", value: 99.99 },
      ]);
    })
  );

  it("fails when required company attribute is missing", async () => {
    const def = makeCompanyDef({
      key: "industry",
      isRequired: true,
    });
    try {
      await Effect.runPromise(parseCompanyCustomAttributes({}, [def]));
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
    }
  });
});

describe("parsePersonAttributes", () => {
  const contactDefs: readonly TContactAttributeDefinition[] = [];
  const companyDefs: readonly TCompanyAttributeDefinition[] = [];

  it.effect("parses minimal valid person data", () =>
    Effect.gen(function* () {
      const result = yield* parsePersonAttributes(
        { userId: "user_1", email: "a@b.com", name: "Alice" },
        contactDefs,
        companyDefs
      );
      expect(result.commonFields).toEqual({
        userId: "user_1",
        email: "a@b.com",
        name: "Alice",
      });
      expect(result.customAttributes).toEqual([]);
      expect(result.companies).toEqual([]);
    })
  );

  it("fails when required contact fields are missing", async () => {
    try {
      await Effect.runPromise(
        parsePersonAttributes({}, contactDefs, companyDefs)
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      expect((error as DataValidationError).message).toContain(
        "Invalid contact fields"
      );
    }
  });

  it("fails on invalid email type", async () => {
    try {
      await Effect.runPromise(
        parsePersonAttributes({ userId: 123 }, contactDefs, companyDefs)
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      expect((error as DataValidationError).message).toContain(
        "Invalid contact fields"
      );
    }
  });

  it.effect("parses contact custom attributes alongside common fields", () =>
    Effect.gen(function* () {
      const def = makeContactDef({ key: "city", type: "TEXT" });
      const result = yield* parsePersonAttributes(
        {
          userId: "user_1",
          email: "a@b.com",
          name: "Alice",
          customFields: { city: "London" },
        },
        [def],
        companyDefs
      );
      expect(result.commonFields).toEqual({
        userId: "user_1",
        email: "a@b.com",
        name: "Alice",
      });
      expect(result.customAttributes).toHaveLength(1);
      expect(result.customAttributes[0]?.key).toBe("city");
    })
  );

  it.effect("parses companies with common fields", () =>
    Effect.gen(function* () {
      const result = yield* parsePersonAttributes(
        {
          userId: "user_1",
          email: "a@b.com",
          name: "Alice",
          companies: [
            { id: "comp_1", name: "Acme" },
            { id: "comp_2", name: "Beta" },
          ],
        },
        contactDefs,
        companyDefs
      );
      expect(result.companies).toHaveLength(2);
      expect(result.companies[0]?.commonFields).toEqual({
        id: "comp_1",
        name: "Acme",
      });
      expect(result.companies[1]?.commonFields).toEqual({
        id: "comp_2",
        name: "Beta",
      });
    })
  );

  it.effect("parses companies with custom attributes", () =>
    Effect.gen(function* () {
      const companyDef = makeCompanyDef({
        key: "industry",
        type: "TEXT",
      });
      const result = yield* parsePersonAttributes(
        {
          userId: "user_1",
          email: "a@b.com",
          name: "Alice",
          companies: [
            {
              id: "comp_1",
              name: "Acme",
              customFields: { industry: "tech" },
            },
          ],
        },
        contactDefs,
        [companyDef]
      );
      expect(result.companies).toHaveLength(1);
      expect(result.companies[0]?.commonFields).toEqual({
        id: "comp_1",
        name: "Acme",
      });
      expect(result.companies[0]?.customAttributes).toHaveLength(1);
      expect(result.companies[0]?.customAttributes[0]?.key).toBe("industry");
    })
  );

  it.effect(
    "returns empty companies array when companies is not an array",
    () =>
      Effect.gen(function* () {
        const result = yield* parsePersonAttributes(
          {
            userId: "user_1",
            email: "a@b.com",
            name: "Alice",
            companies: "not-an-array",
          },
          contactDefs,
          companyDefs
        );
        expect(result.companies).toEqual([]);
      })
  );

  it.effect("returns empty companies array when companies is empty array", () =>
    Effect.gen(function* () {
      const result = yield* parsePersonAttributes(
        {
          userId: "user_1",
          email: "a@b.com",
          name: "Alice",
          companies: [],
        },
        contactDefs,
        companyDefs
      );
      expect(result.companies).toEqual([]);
    })
  );

  it("fails for non-object data (null)", async () => {
    try {
      await Effect.runPromise(
        parsePersonAttributes(null, contactDefs, companyDefs)
      );
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
    }
  });

  it.effect("ignores excess properties on common fields", () =>
    Effect.gen(function* () {
      const result = yield* parsePersonAttributes(
        {
          userId: "user_1",
          email: "a@b.com",
          name: "Alice",
          extra: "should-be-ignored",
        },
        contactDefs,
        companyDefs
      );
      expect(result.commonFields).toEqual({
        userId: "user_1",
        email: "a@b.com",
        name: "Alice",
      });
    })
  );
});
