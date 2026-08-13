import { GITHUB_INSTALLATION_TOKEN_EXPIRY_SKEW_MS } from "@feeblo/integration-github";
import { describe, expect, it } from "vitest";

describe("GitHub App installation token policy", () => {
  it("refreshes tokens before the one-hour GitHub expiry boundary", () => {
    expect(GITHUB_INSTALLATION_TOKEN_EXPIRY_SKEW_MS).toBeGreaterThan(0);
  });
});
