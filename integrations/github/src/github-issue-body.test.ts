import { describe, expect, it } from "@effect/vitest";
import { renderGitHubIssueBody } from "./github-issue-body";

describe("renderGitHubIssueBody", () => {
  it("keeps the canonical Feeblo feedback URL in the issue body", () => {
    const postUrl = new URL("https://feeblo.example/org/post/ideas/dark-mode");
    const body = renderGitHubIssueBody({ postUrl });

    expect(body).toContain(postUrl.href);
    expect(body).toContain("Feeblo feedback");
  });
});
