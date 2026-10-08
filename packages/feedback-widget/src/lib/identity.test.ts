import { isWidgetIdentity } from "@feeblo/domain/widget/schema";
import { describe, expect, it } from "vitest";

/**
 * The identity the embedding page posts is the widget's other wire boundary.
 * The iframe's `IDENTIFY` guard now runs the contract's decoder, so a malformed
 * identity is rejected where it arrives instead of being stored and posted
 * back as `IDENTITY_CHANGED`.
 */
describe("widget identity guard", () => {
  it("accepts the SDK's nested custom fields", () => {
    expect(
      isWidgetIdentity({
        id: "usr_1",
        customFields: {
          plan: "pro",
          seats: 4,
          tags: ["ui", "api"],
          team: { name: "Core" },
        },
      })
    ).toBe(true);
  });

  it("accepts an optional SSO token", () => {
    expect(isWidgetIdentity({ id: "usr_1", token: "signed.jwt" })).toBe(true);
  });

  it("rejects an identity without an id", () => {
    expect(isWidgetIdentity({ email: "person@example.test" })).toBe(false);
  });

  it("rejects a company that is missing its name", () => {
    expect(
      isWidgetIdentity({ id: "usr_1", companies: [{ id: "cmp_1" }] })
    ).toBe(false);
  });
});
