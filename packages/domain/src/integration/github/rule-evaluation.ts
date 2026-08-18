import type { TGitHubIssueState } from "@feeblo/db/validation-schema/github-integration";

import type { GitHubSyncRule } from "./schema";

/** Determines which enabled rules match the current aggregate state of linked GitHub issues. */
export const findMatchingGitHubSyncRules = (
  rules: readonly GitHubSyncRule[],
  issueStates: readonly TGitHubIssueState[]
): readonly GitHubSyncRule[] => {
  if (issueStates.length === 0) {
    return [];
  }
  return rules.filter((rule) => {
    if (!rule.enabled) {
      return false;
    }
    return rule.issueMatchMode === "all"
      ? issueStates.every((state) => state === rule.issueState)
      : issueStates.some((state) => state === rule.issueState);
  });
};
