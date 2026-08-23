import {
  asLegid,
  GitHubSyncRuleId,
  IntegrationConnectionId,
  PostStatusId,
} from "@feeblo/id";
import { describe, expect, it } from "vitest";

import { findMatchingGitHubSyncRules } from "./github-rule-evaluation";

const rule = {
  id: asLegid(GitHubSyncRuleId)("gsr_test"),
  connectionId: asLegid(IntegrationConnectionId)("icn_test"),
  issueMatchMode: "all" as const,
  issueState: "closed" as const,
  postStatusId: asLegid(PostStatusId)("pss_closed"),
  upvoterNotificationPolicy: "notify_upvoters" as const,
  enabled: true,
};

describe("findMatchingGitHubSyncRules", () => {
  it("requires every linked issue for an all rule", () => {
    expect(findMatchingGitHubSyncRules([rule], ["closed", "open"])).toEqual([]);
    expect(findMatchingGitHubSyncRules([rule], ["closed", "closed"])).toEqual([
      rule,
    ]);
  });

  it("matches at least one linked issue for an any rule and ignores disabled rules", () => {
    expect(
      findMatchingGitHubSyncRules(
        [
          { ...rule, issueMatchMode: "any" },
          { ...rule, enabled: false },
        ],
        ["open", "closed"]
      )
    ).toEqual([{ ...rule, issueMatchMode: "any" }]);
  });

  it("does not match a rule when a post has no linked issues", () => {
    expect(findMatchingGitHubSyncRules([rule], [])).toEqual([]);
  });
});
