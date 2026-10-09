import { describe, expect, it } from "@effect/vitest";

import { shouldMountE2eRoutes } from "./router";

/**
 * The rule that keeps the test-only routes off the network.
 *
 * A lone `E2E_TEST_MAILER=true` used to be enough to serve `/__e2e/emails`
 * (every rendered email, including password-reset links and verification
 * codes), `/__e2e/set-plan`, and `/__e2e/seed-roadmap` in any non-production
 * environment. Each condition below is one half of the fix.
 */
describe("shouldMountE2eRoutes", () => {
  const enabled = {
    e2eRoutesEnabled: true,
    hasMailbox: true,
    nodeEnv: "development",
  };

  it("mounts with the explicit route flag, a mailbox, and a non-production environment", () => {
    expect(shouldMountE2eRoutes(enabled)).toBe(true);
  });

  it("does not mount from the mailer flag alone", () => {
    expect(shouldMountE2eRoutes({ ...enabled, e2eRoutesEnabled: false })).toBe(
      false
    );
  });

  it("does not mount without a mailbox to serve", () => {
    expect(shouldMountE2eRoutes({ ...enabled, hasMailbox: false })).toBe(false);
  });

  it("never mounts in production", () => {
    expect(shouldMountE2eRoutes({ ...enabled, nodeEnv: "production" })).toBe(
      false
    );
  });
});
