import { describe, expect, it } from "@effect/vitest";
import { renderGitHubIssueBody } from "./github-issue-body";

describe("renderGitHubIssueBody", () => {
  it("uses the post description as the issue body", () => {
    const body = renderGitHubIssueBody({
      description: "Dark mode hurts my eyes at night.",
    });

    expect(body).toBe("Dark mode hurts my eyes at night.");
  });

  it("falls back to a generic body when the description is empty", () => {
    const body = renderGitHubIssueBody({ description: "   " });

    expect(body).toBe("This issue was created from Feeblo feedback.");
  });

  it("falls back to a generic body without a description", () => {
    const body = renderGitHubIssueBody({});

    expect(body).toBe("This issue was created from Feeblo feedback.");
  });
});
