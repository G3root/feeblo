import { describe, expect, it } from "vitest";
import { EmbedError } from "../src/errors";
import { normalizeUserIdentity } from "../src/identity";

describe("normalizeUserIdentity", () => {
  it("preserves the id field", () => {
    const result = normalizeUserIdentity({ id: "user_1" });

    expect(result.id).toBe("user_1");
  });

  it("throws INVALID_IDENTITY when id is empty", () => {
    expect(() => normalizeUserIdentity({ id: "" })).toThrow(EmbedError);

    try {
      normalizeUserIdentity({ id: "" });
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedError);
      expect((err as EmbedError).code).toBe("INVALID_IDENTITY");
    }
  });

  it("strips undefined fields from the user", () => {
    const result = normalizeUserIdentity({
      id: "user_1",
      email: undefined,
      name: "Doe",
    });

    expect(result).not.toHaveProperty("email");
    expect(result).toHaveProperty("name", "Doe");
  });

  it("preserves defined optional fields", () => {
    const user = {
      id: "user_1",
      email: "test@example.com",
      name: "John Doe",
      avatar: "https://example.com/avatar.png",
      token: "tok_123",
    };
    const result = normalizeUserIdentity(user);

    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("John Doe");
    expect(result.avatar).toBe("https://example.com/avatar.png");
    expect(result.token).toBe("tok_123");
  });

  it("normalizes companies to only include known keys", () => {
    const result = normalizeUserIdentity({
      id: "user_1",
      companies: [
        {
          id: "comp_1",
          name: "Acme Inc",
          monthlySpend: 1000,
          extraField: "should be stripped",
        } as any,
      ],
    });

    expect(result.companies).toHaveLength(1);
    const company = result.companies?.[0]!;
    expect(company).toHaveProperty("id", "comp_1");
    expect(company).toHaveProperty("name", "Acme Inc");
    expect(company).toHaveProperty("monthlySpend", 1000);
    expect(company).not.toHaveProperty("extraField");
  });

  it("strips undefined company fields", () => {
    const result = normalizeUserIdentity({
      id: "user_1",
      companies: [
        {
          id: "comp_1",
          name: "Acme",
          monthlySpend: undefined,
        },
      ],
    });

    expect(result.companies?.[0]!).not.toHaveProperty("monthlySpend");
  });

  it("omits companies when not provided", () => {
    const result = normalizeUserIdentity({ id: "user_1" });

    expect(result).not.toHaveProperty("companies");
  });
});
