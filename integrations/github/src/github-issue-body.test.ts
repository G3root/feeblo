import { describe, expect, it } from "@effect/vitest";

import {
  GITHUB_ISSUE_BODY_CHARACTER_LIMIT,
  renderGitHubIssueBody,
} from "./github-issue-body";

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

  it("falls back to a generic body when the description is null", () => {
    const body = renderGitHubIssueBody({ description: null });

    expect(body).toBe("This issue was created from Feeblo feedback.");
  });

  it("returns the description unchanged when it is exactly at the limit", () => {
    const description = "a".repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT);

    expect(renderGitHubIssueBody({ description })).toBe(description);
  });

  it("truncates an over-limit description and reserves room for the marker", () => {
    const description = "a".repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT + 100);

    const body = renderGitHubIssueBody({ description });

    expect(body.length).toBe(GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
    expect(body.endsWith("…[Truncated — view the full post on Feeblo]")).toBe(
      true
    );
  });

  it("includes the post link in the truncation marker without exceeding the limit", () => {
    const description = "a".repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT + 100);
    const postUrl = "https://feeblo.example/org/post/slug";

    const body = renderGitHubIssueBody({ description, postUrl });

    expect(body.length).toBe(GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
    expect(body.endsWith(`…[View the full post on Feeblo](${postUrl})`)).toBe(
      true
    );
  });
});
