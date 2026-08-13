import { describe, expect, it } from "vitest";

import { getSsoTokenFromHash } from "../src/app/sso-token";

describe("getSsoTokenFromHash", () => {
  it("reads the token from a bare fragment", () => {
    expect(getSsoTokenFromHash("#ssoToken=signed.jwt.token")).toBe(
      "signed.jwt.token"
    );
  });

  it("reads the token alongside other fragment params", () => {
    expect(getSsoTokenFromHash("#planned&ssoToken=signed.jwt.token")).toBe(
      "signed.jwt.token"
    );
  });

  it("returns null when there is no hash", () => {
    expect(getSsoTokenFromHash("")).toBeNull();
  });

  it("returns null when the hash has no ssoToken", () => {
    expect(getSsoTokenFromHash("#planned")).toBeNull();
  });

  it("decodes URL-encoded tokens", () => {
    expect(getSsoTokenFromHash("#ssoToken=a%20b%2Bc")).toBe("a b+c");
  });
});
