import * as S from "effect/Schema";
import { describe, expect, it } from "vitest";

import { PlansResponse } from "./schema";

/**
 * `/api/plans` is HTTP-cached for an hour and decoded strictly by the web
 * client, so a response served before a key existed must still decode. The
 * `workspaces` limit was added last; older cached bodies omit it.
 */
describe("PlansResponse", () => {
  const decode = S.decodeUnknownSync(PlansResponse);

  const plan = (limits: Record<string, number | null>) => ({
    key: "free" as const,
    name: "Free",
    includesLabel: null,
    limits,
    capabilities: {
      roadmap: true,
      changelog: true,
      unlimitedEndUsers: true,
      unlimitedPosts: true,
      privateBoards: false,
      privateRoadmaps: false,
      removeBranding: false,
      subscriberEmails: false,
      widgetSso: false,
      integrations: false,
      publicApi: false,
    },
    features: [],
    prices: { month: null, year: null },
  });

  const legacyLimits = {
    feedbackBoards: 2,
    members: 2,
    changelogCategories: 3,
    crmEntries: 10,
  };

  /** A body from before `privilegedMembers` was renamed to `members`. */
  const preRenameLimits = {
    feedbackBoards: 2,
    privilegedMembers: 2,
    changelogCategories: 3,
    crmEntries: 10,
    workspaces: 3,
  };

  it("decodes a body that predates the workspaces key", () => {
    const decoded = decode({ plans: [plan(legacyLimits)] });

    expect(decoded.plans[0]?.limits.workspaces).toBeNull();
  });

  it("reads the allowance from a body that predates the members rename", () => {
    const decoded = decode({ plans: [plan(preRenameLimits)] });

    expect(decoded.plans[0]?.limits.members).toBe(2);
  });

  it("lets a present members value win over the legacy key", () => {
    expect(
      decode({ plans: [plan({ ...preRenameLimits, members: 5 })] }).plans[0]
        ?.limits.members
    ).toBe(5);
    // An explicit `null` means "unlimited" and must not be replaced by the
    // legacy finite value the same body carries.
    expect(
      decode({ plans: [plan({ ...preRenameLimits, members: null })] }).plans[0]
        ?.limits.members
    ).toBeNull();
  });

  it("reads a body that carries neither key as unlimited", () => {
    const decoded = decode({
      plans: [
        plan({
          feedbackBoards: 2,
          changelogCategories: 3,
          crmEntries: 10,
          workspaces: 3,
        }),
      ],
    });

    expect(decoded.plans[0]?.limits.members).toBeNull();
  });

  it("encodes the current key and drops the legacy one", () => {
    const encoded = S.encodeSync(PlansResponse)(
      decode({ plans: [plan(preRenameLimits)] })
    );

    expect(encoded.plans[0]?.limits.members).toBe(2);
    expect(encoded.plans[0]?.limits).not.toHaveProperty("privilegedMembers");
  });

  it("keeps present finite numbers and explicit nulls unchanged", () => {
    expect(
      decode({ plans: [plan({ ...legacyLimits, workspaces: 3 })] }).plans[0]
        ?.limits.workspaces
    ).toBe(3);
    expect(
      decode({ plans: [plan({ ...legacyLimits, workspaces: null })] }).plans[0]
        ?.limits.workspaces
    ).toBeNull();
  });
});
