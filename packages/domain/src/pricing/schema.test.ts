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
    privilegedMembers: 2,
    changelogCategories: 3,
    submissionNotificationRecipients: 1,
    crmEntries: 10,
  };

  it("decodes a body that predates the workspaces key", () => {
    const decoded = decode({ plans: [plan(legacyLimits)] });

    expect(decoded.plans[0]?.limits.workspaces).toBeNull();
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
