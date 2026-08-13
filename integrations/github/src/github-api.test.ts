import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import { describe, expect, it } from "vitest";
import {
  classifyGitHubApiError,
  GitHubInstallationAccessToken,
  GitHubInstallationRepositories,
  GitHubIssue,
  GitHubUserInstallations,
  renderGitHubIssueBacklinkComment,
} from "./github-api";

describe("GitHub App API response schemas", () => {
  it("decodes issues, installation tokens, and paginated installation repositories", async () => {
    const [issue, token, repositories] = await Effect.runPromise(
      Effect.all([
        Schema.decodeUnknownEffect(GitHubIssue)({
          html_url: "https://github.com/acme/feedback/issues/7",
          id: 7,
          node_id: "I_7",
          number: 7,
          state: "open",
          title: "Dark mode",
        }),
        Schema.decodeUnknownEffect(GitHubInstallationAccessToken)({
          expires_at: "2030-01-01T00:00:00Z",
          token: "ghs_installation_token",
        }),
        Schema.decodeUnknownEffect(GitHubInstallationRepositories)({
          repositories: [
            {
              full_name: "acme/feedback",
              id: 1,
              name: "feedback",
              owner: { login: "acme" },
              private: true,
            },
          ],
          total_count: 1,
        }),
      ])
    );
    expect(issue.number).toBe(7);
    expect(token.token).toBe("ghs_installation_token");
    expect(repositories.repositories[0]?.full_name).toBe("acme/feedback");
  });

  it("rejects malformed App installation payloads", async () => {
    const result = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(GitHubUserInstallations)({
        installations: [{ id: "not-a-number" }],
        total_count: 1,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

describe("GitHub API failure classification", () => {
  it("only treats a 403 as rate limited when GitHub reports rate limiting", () => {
    expect(
      classifyGitHubApiError(
        { status: 403, headers: Headers.fromInput({}) },
        "repository listing"
      )._tag
    ).toBe("IntegrationProviderPermanentRejection");
    expect(
      classifyGitHubApiError(
        {
          status: 403,
          headers: Headers.fromInput({ "x-ratelimit-remaining": "0" }),
        },
        "repository listing"
      )._tag
    ).toBe("IntegrationProviderRateLimitedError");
  });
});

describe("GitHub bot backlink comments", () => {
  it("renders a bot-authored Feeblo backlink without editing the issue body", () => {
    const backlinkUrl = new URL("https://feeblo.example/post/one");
    expect(renderGitHubIssueBacklinkComment({ backlinkUrl })).toContain(
      backlinkUrl.href
    );
  });
});
