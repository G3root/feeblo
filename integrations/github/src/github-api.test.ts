import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";

import {
  classifyGitHubApiError,
  GitHubInstallationAccessToken,
  GitHubInstallationRepositories,
  GitHubIssue,
  GitHubUserInstallations,
  makeGitHubApiClient,
  renderGitHubIssueBacklinkComment,
} from "./github-api";

describe("GitHub App API response schemas", () => {
  it.effect(
    "decodes issues, installation tokens, and paginated installation repositories",
    () =>
      Effect.gen(function* () {
        const [issue, token, repositories] = yield* Effect.all([
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
        ]);
        expect(issue.number).toBe(7);
        expect(token.token).toBe("ghs_installation_token");
        expect(repositories.repositories[0]?.full_name).toBe("acme/feedback");
      })
  );

  it.effect("rejects malformed App installation payloads", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknownEffect(GitHubUserInstallations)({
          installations: [{ id: "not-a-number" }],
          total_count: 1,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
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

describe("GitHub App installation id validation", () => {
  it.effect(
    "rejects a non-numeric installation id before minting a token",
    () =>
      Effect.gen(function* () {
        const client = makeGitHubApiClient();
        const tag = yield* client
          .createInstallationAccessToken({
            appJwt: Redacted.make("app-jwt"),
            installationId: "not-a-number",
          })
          .pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => "success",
            })
          );
        expect(tag).toBe("IntegrationProviderInvalidConfigurationError");
      })
  );

  it.effect("rejects a non-numeric installation id before removal", () =>
    Effect.gen(function* () {
      const client = makeGitHubApiClient();
      const tag = yield* client
        .deleteInstallation({
          appJwt: Redacted.make("app-jwt"),
          installationId: "not-a-number",
        })
        .pipe(
          Effect.match({
            onFailure: (error) => error._tag,
            onSuccess: () => "success",
          })
        );
      expect(tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );
});

describe("GitHub bot backlink comments", () => {
  it("renders the feedback-platform backlink as a markdown link", () => {
    const backlinkUrl = new URL("https://feeblo.example/post/one");
    expect(renderGitHubIssueBacklinkComment({ backlinkUrl })).toBe(
      "The issue is linked to our feedback platform. For feedback and updates, please visit [this link](https://feeblo.example/post/one)"
    );
  });
});
