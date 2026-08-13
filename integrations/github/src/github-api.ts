import {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { GitHubApiFailure } from "./github-errors";
import { githubProviderKey } from "./github-manifest";

/** GitHub's public REST API origin. */
export const GITHUB_API_BASE_URL = "https://api.github.com";
/** GitHub endpoint used only to verify the administrator completing setup. */
export const GITHUB_OAUTH_TOKEN_URL =
  "https://github.com/login/oauth/access_token";
/** Per-request upper bound for GitHub REST API calls. */
export const GITHUB_API_REQUEST_TIMEOUT_MS = 10_000;

/** A short-lived token minted for one GitHub App installation. */
export const GitHubInstallationAccessToken = Schema.Struct({
  expires_at: Schema.DateFromString,
  token: Schema.NonEmptyString,
});
export interface GitHubInstallationAccessToken
  extends Schema.Schema.Type<typeof GitHubInstallationAccessToken> {}

/** One-time user token returned during GitHub App installer verification. */
export const GitHubUserAccessToken = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.String,
});
export interface GitHubUserAccessToken
  extends Schema.Schema.Type<typeof GitHubUserAccessToken> {}

/** GitHub account associated with an app installation. */
export const GitHubInstallationAccount = Schema.Struct({
  id: Schema.Number,
  login: Schema.NonEmptyString,
  type: Schema.Literals(["Organization", "User"]),
});
export interface GitHubInstallationAccount
  extends Schema.Schema.Type<typeof GitHubInstallationAccount> {}

/** Installation facts necessary to verify setup and route globally delivered webhooks. */
export const GitHubUserInstallation = Schema.Struct({
  account: GitHubInstallationAccount,
  id: Schema.Number,
  repository_selection: Schema.Literals(["all", "selected"]),
  suspended_at: Schema.NullOr(Schema.DateFromString),
});
export interface GitHubUserInstallation
  extends Schema.Schema.Type<typeof GitHubUserInstallation> {}

/** GitHub's user-installations response envelope. */
export const GitHubUserInstallations = Schema.Struct({
  installations: Schema.Array(GitHubUserInstallation),
  total_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface GitHubUserInstallations
  extends Schema.Schema.Type<typeof GitHubUserInstallations> {}

/** A repository accessible to an authenticated GitHub App installation. */
export const GitHubRepository = Schema.Struct({
  full_name: Schema.NonEmptyString,
  id: Schema.Number,
  name: Schema.NonEmptyString,
  owner: Schema.Struct({ login: Schema.NonEmptyString }),
  private: Schema.Boolean,
});
export interface GitHubRepository
  extends Schema.Schema.Type<typeof GitHubRepository> {}

/** Paginated repository response returned to a GitHub App installation. */
export const GitHubInstallationRepositories = Schema.Struct({
  repositories: Schema.Array(GitHubRepository),
  total_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface GitHubInstallationRepositories
  extends Schema.Schema.Type<typeof GitHubInstallationRepositories> {}

/** Safe issue fields used to persist a normalized external resource link. */
export const GitHubIssue = Schema.Struct({
  html_url: Schema.URLFromString,
  id: Schema.Number,
  node_id: Schema.String,
  number: Schema.Int,
  state: Schema.Literals(["open", "closed"]),
  title: Schema.String,
});
export interface GitHubIssue extends Schema.Schema.Type<typeof GitHubIssue> {}

/** Formats the bot-authored comment linking an existing GitHub issue back to Feeblo. */
export const renderGitHubIssueBacklinkComment = ({
  backlinkUrl,
}: {
  readonly backlinkUrl: URL;
}): string =>
  `This issue is linked to feedback in Feeblo.\n\nContinue the feedback discussion: ${backlinkUrl.href}`;

/** Maps GitHub transport statuses into integration kernel failures. */
export const classifyGitHubApiError = (
  response: { readonly status?: number },
  context: string
): GitHubApiFailure => {
  const status = response.status;
  if (status === 401) {
    return new IntegrationProviderAuthenticationError({
      message: `GitHub rejected authentication during ${context}`,
      provider: githubProviderKey,
      httpStatus: status,
    });
  }
  if (status === 403 || status === 429) {
    return new IntegrationProviderRateLimitedError({
      message: `GitHub rate limited ${context}`,
      provider: githubProviderKey,
      ...(status === undefined ? {} : { httpStatus: status }),
    });
  }
  if (status !== undefined && status >= 500) {
    return new IntegrationProviderTemporaryFailure({
      message: `GitHub temporarily failed during ${context}`,
      provider: githubProviderKey,
      httpStatus: status,
    });
  }
  if (status === 404 || status === 410) {
    return new IntegrationProviderInvalidConfigurationError({
      message: `GitHub repository, installation, or issue was not found during ${context}`,
      provider: githubProviderKey,
      httpStatus: status,
    });
  }
  return new IntegrationProviderPermanentRejection({
    message: `GitHub rejected ${context}`,
    provider: githubProviderKey,
    ...(status === undefined ? {} : { httpStatus: status }),
  });
};

/** Direct, schema-decoding adapter for the GitHub REST API. */
export interface GitHubApiClient {
  /** Mints an ephemeral installation token with an App JWT. */
  readonly createInstallationAccessToken: (input: {
    readonly appJwt: Redacted.Redacted<string>;
    readonly installationId: string;
  }) => Effect.Effect<GitHubInstallationAccessToken, GitHubApiFailure>;
  /** Creates an issue as the GitHub App installation bot. */
  readonly createIssue: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly body: string;
    readonly repositoryName: string;
    readonly repositoryOwner: string;
    readonly title: string;
  }) => Effect.Effect<GitHubIssue, GitHubApiFailure>;
  /** Posts a bot-authored Feeblo backlink comment on an existing issue. */
  readonly createIssueBacklinkComment: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly backlinkUrl: URL;
    readonly issueNumber: number;
    readonly repositoryName: string;
    readonly repositoryOwner: string;
  }) => Effect.Effect<void, GitHubApiFailure>;
  /** Uninstalls the GitHub App from one account using App authentication. */
  readonly deleteInstallation: (input: {
    readonly appJwt: Redacted.Redacted<string>;
    readonly installationId: string;
  }) => Effect.Effect<void, GitHubApiFailure>;
  /** Exchanges the callback code only to prove the setup user can access the installation. */
  readonly exchangeUserAccessToken: (input: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly code: string;
  }) => Effect.Effect<GitHubUserAccessToken, GitHubApiFailure>;
  /** Resolves a linked issue before Feeblo persists its provider-neutral resource. */
  readonly getIssue: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly issueNumber: number;
    readonly repositoryName: string;
    readonly repositoryOwner: string;
  }) => Effect.Effect<GitHubIssue, GitHubApiFailure>;
  /** Returns one repository page visible to an installation token. */
  readonly listInstallationRepositories: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly page: number;
  }) => Effect.Effect<GitHubInstallationRepositories, GitHubApiFailure>;
  /** Lists installations the one-time setup user can access. */
  readonly listUserInstallations: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly page: number;
  }) => Effect.Effect<GitHubUserInstallations, GitHubApiFailure>;
}

/** Creates a direct Effect HttpClient adapter; every untrusted response is decoded before leaving this module. */
export const makeGitHubApiClient = (): GitHubApiClient => {
  const request = Effect.fn("GitHubApi.request")(
    (input: {
      readonly context: string;
      readonly httpRequest: HttpClientRequest.HttpClientRequest;
    }) =>
      Effect.gen(function* () {
        const response = yield* HttpClient.execute(input.httpRequest).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.timeoutOrElse({
            duration: GITHUB_API_REQUEST_TIMEOUT_MS,
            orElse: () =>
              Effect.fail(
                new IntegrationProviderTemporaryFailure({
                  message: `GitHub request timed out during ${input.context}`,
                  provider: githubProviderKey,
                })
              ),
          }),
          Effect.mapError(
            () =>
              new IntegrationProviderTemporaryFailure({
                message: `GitHub request failed during ${input.context}`,
                provider: githubProviderKey,
              })
          )
        );
        const body = yield* response.json.pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderPermanentRejection({
                message: `GitHub returned an invalid response during ${input.context}`,
                provider: githubProviderKey,
                httpStatus: response.status,
              })
          )
        );
        if (response.status < 200 || response.status >= 300) {
          return yield* classifyGitHubApiError(
            { status: response.status },
            input.context
          );
        }
        return body;
      })
  );
  const authenticatedJson = (
    path: string,
    input: {
      readonly accessToken: Redacted.Redacted<string>;
      readonly body?: unknown;
      readonly method: "GET" | "POST";
    },
    context: string
  ): Effect.Effect<unknown, GitHubApiFailure> =>
    Effect.gen(function* () {
      let httpRequest = HttpClientRequest.make(input.method)(
        `${GITHUB_API_BASE_URL}${path}`
      );
      httpRequest = HttpClientRequest.setHeaders(httpRequest, {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      });
      httpRequest = HttpClientRequest.bearerToken(
        httpRequest,
        input.accessToken
      );
      if (input.body !== undefined) {
        httpRequest = yield* HttpClientRequest.bodyJson(
          httpRequest,
          input.body
        ).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderPermanentRejection({
                message: `GitHub ${context} request could not be encoded`,
                provider: githubProviderKey,
              })
          )
        );
      }
      return yield* request({ context, httpRequest });
    });
  const authenticatedNoContent = (
    path: string,
    accessToken: Redacted.Redacted<string>,
    context: string
  ): Effect.Effect<void, GitHubApiFailure> =>
    Effect.gen(function* () {
      const httpRequest = HttpClientRequest.bearerToken(
        HttpClientRequest.make("DELETE")(`${GITHUB_API_BASE_URL}${path}`, {
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        }),
        accessToken
      );
      const response = yield* HttpClient.execute(httpRequest).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.timeoutOrElse({
          duration: GITHUB_API_REQUEST_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new IntegrationProviderTemporaryFailure({
                message: `GitHub request timed out during ${context}`,
                provider: githubProviderKey,
              })
            ),
        }),
        Effect.mapError(
          () =>
            new IntegrationProviderTemporaryFailure({
              message: `GitHub request failed during ${context}`,
              provider: githubProviderKey,
            })
        )
      );
      if (response.status === 404 || response.status === 410) {
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* classifyGitHubApiError(
          { status: response.status },
          context
        );
      }
    });
  const decodeResponse =
    <S extends Schema.Constraint>(schema: S, context: string) =>
    (
      effect: Effect.Effect<unknown, GitHubApiFailure>
    ): Effect.Effect<S["Type"], GitHubApiFailure, S["DecodingServices"]> =>
      effect.pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: `GitHub ${context} response was invalid`,
                  provider: githubProviderKey,
                })
            )
          )
        )
      );

  return {
    createIssueBacklinkComment: ({
      accessToken,
      backlinkUrl,
      issueNumber,
      repositoryName,
      repositoryOwner,
    }) =>
      decodeResponse(
        Schema.Struct({ id: Schema.Number }),
        "issue backlink comment"
      )(
        authenticatedJson(
          `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/issues/${issueNumber}/comments`,
          {
            accessToken,
            body: { body: renderGitHubIssueBacklinkComment({ backlinkUrl }) },
            method: "POST",
          },
          "issue backlink comment"
        )
      ).pipe(Effect.asVoid),
    createIssue: ({
      accessToken,
      body,
      repositoryName,
      repositoryOwner,
      title,
    }) =>
      decodeResponse(
        GitHubIssue,
        "issue creation"
      )(
        authenticatedJson(
          `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/issues`,
          { accessToken, body: { body, title }, method: "POST" },
          "issue creation"
        )
      ),
    createInstallationAccessToken: ({ appJwt, installationId }) =>
      decodeResponse(
        GitHubInstallationAccessToken,
        "installation token creation"
      )(
        authenticatedJson(
          `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
          { accessToken: appJwt, method: "POST" },
          "installation token creation"
        )
      ),
    deleteInstallation: ({ appJwt, installationId }) =>
      authenticatedNoContent(
        `/app/installations/${encodeURIComponent(installationId)}`,
        appJwt,
        "installation removal"
      ),
    exchangeUserAccessToken: ({ clientId, clientSecret, code }) =>
      Effect.gen(function* () {
        const httpRequest = yield* HttpClientRequest.bodyJson(
          HttpClientRequest.post(GITHUB_OAUTH_TOKEN_URL, {
            headers: { accept: "application/json" },
          }),
          {
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            code,
          }
        ).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderPermanentRejection({
                message: "GitHub setup user-token request could not be encoded",
                provider: githubProviderKey,
              })
          )
        );
        return yield* decodeResponse(
          GitHubUserAccessToken,
          "setup user-token exchange"
        )(request({ context: "setup user-token exchange", httpRequest }));
      }),
    getIssue: ({ accessToken, issueNumber, repositoryName, repositoryOwner }) =>
      decodeResponse(
        GitHubIssue,
        "issue lookup"
      )(
        authenticatedJson(
          `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/issues/${issueNumber}`,
          { accessToken, method: "GET" },
          "issue lookup"
        )
      ),
    listInstallationRepositories: ({ accessToken, page }) =>
      decodeResponse(
        GitHubInstallationRepositories,
        "installation repository listing"
      )(
        authenticatedJson(
          `/installation/repositories?per_page=100&page=${page}`,
          { accessToken, method: "GET" },
          "installation repository listing"
        )
      ),
    listUserInstallations: ({ accessToken, page }) =>
      decodeResponse(
        GitHubUserInstallations,
        "setup user installation listing"
      )(
        authenticatedJson(
          `/user/installations?per_page=100&page=${page}`,
          { accessToken, method: "GET" },
          "setup user installation listing"
        )
      ),
  };
};
