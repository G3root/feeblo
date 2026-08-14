import * as GitHub from "@distilled.cloud/github";
import {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
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
/** GitHub App installation ids are positive decimal integers. */
const GITHUB_INSTALLATION_ID_PATTERN = /^[1-9]\d*$/;

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
  response: {
    readonly status?: number;
    readonly headers?: Headers.Headers;
  },
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
  const isRateLimited403 =
    status === 403 &&
    response.headers !== undefined &&
    (Headers.get(response.headers, "x-ratelimit-remaining").pipe(
      Option.getOrUndefined
    ) === "0" ||
      Headers.has(response.headers, "retry-after"));
  if (isRateLimited403 || status === 429) {
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

/** Extracts the stable `_tag` of a tagged SDK error, if present. */
const sdkErrorTag = (error: unknown): string | undefined =>
  Predicate.isObject(error) && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;

/** Extracts a human-readable message from an SDK error, if present. */
const sdkErrorMessage = (error: unknown): string | undefined =>
  Predicate.isObject(error) &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : undefined;

/** Extracts a server-provided retry hint from an SDK error, if present. */
const sdkRetryAfterMs = (error: unknown): number | undefined =>
  Predicate.isObject(error) &&
  "retryAfter" in error &&
  Duration.isDuration(error.retryAfter)
    ? Duration.toMillis(error.retryAfter)
    : undefined;

/** Maps the Effect-native SDK's typed errors onto the integration kernel failure algebra. */
const mapSdkError =
  (context: string) =>
  (error: unknown): GitHubApiFailure => {
    if (HttpClientError.isHttpClientError(error)) {
      return new IntegrationProviderTemporaryFailure({
        message: `GitHub request failed during ${context}`,
        provider: githubProviderKey,
      });
    }
    const detail = sdkErrorMessage(error) ?? `GitHub rejected ${context}`;
    switch (sdkErrorTag(error)) {
      case "Unauthorized":
        return new IntegrationProviderAuthenticationError({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 401,
        });
      case "Forbidden":
        return new IntegrationProviderAuthenticationError({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 403,
        });
      case "TooManyRequests": {
        const retryAfterMs = sdkRetryAfterMs(error);
        return new IntegrationProviderRateLimitedError({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 429,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        });
      }
      case "BadRequest":
        return new IntegrationProviderPermanentRejection({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 400,
        });
      case "Conflict":
        return new IntegrationProviderPermanentRejection({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 409,
        });
      case "UnprocessableEntity":
        return new IntegrationProviderPermanentRejection({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 422,
        });
      case "Locked":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 423,
        });
      case "NotFound":
        return new IntegrationProviderInvalidConfigurationError({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 404,
        });
      case "Gone":
        return new IntegrationProviderInvalidConfigurationError({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 410,
        });
      case "InternalServerError":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 500,
        });
      case "BadGateway":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 502,
        });
      case "ServiceUnavailable":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 503,
        });
      case "GatewayTimeout":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
          httpStatus: 504,
        });
      case "ConfigError":
        return new IntegrationProviderInvalidConfigurationError({
          message: detail,
          provider: githubProviderKey,
        });
      case "UnknownGithubError":
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
        });
      case "GithubParseError":
        return new IntegrationProviderTemporaryFailure({
          message: `GitHub returned an unparsable response during ${context}`,
          provider: githubProviderKey,
        });
      default:
        return new IntegrationProviderTemporaryFailure({
          message: detail,
          provider: githubProviderKey,
        });
    }
  };

/** Provides the SDK's per-request bearer credentials from one redacted token. */
const credentialsLayer = (
  token: Redacted.Redacted<string>
): Layer.Layer<GitHub.Credentials> =>
  Layer.succeed(
    GitHub.Credentials,
    Effect.succeed({
      token,
      apiBaseUrl: GITHUB_API_BASE_URL,
      userAgent: GitHub.DEFAULT_USER_AGENT,
    })
  );

/**
 * Runs one generated SDK operation with bearer credentials, no SDK-level
 * retries (the durable delivery scheduler owns retry policy), the repository's
 * request timeout, and the SDK's typed errors mapped onto the kernel algebra.
 */
const withSdk = <A, E>(
  token: Redacted.Redacted<string>,
  effect: Effect.Effect<A, E, GitHub.Credentials | HttpClient.HttpClient>,
  context: string
): Effect.Effect<A, GitHubApiFailure> =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(credentialsLayer(token), FetchHttpClient.layer)
    ),
    Effect.mapError(mapSdkError(context)),
    Effect.timeoutOrElse({
      duration: GITHUB_API_REQUEST_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new IntegrationProviderTemporaryFailure({
            message: `GitHub request timed out during ${context}`,
            provider: githubProviderKey,
          })
        ),
    })
  );

/** Decodes an SDK response back through one of the repository's stricter schemas. */
const decodeSdkResponse =
  <S extends Schema.Constraint>(schema: S, context: string) =>
  (
    value: unknown
  ): Effect.Effect<S["Type"], GitHubApiFailure, S["DecodingServices"]> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        () =>
          new IntegrationProviderTemporaryFailure({
            message: `GitHub ${context} response was invalid`,
            provider: githubProviderKey,
          })
      )
    );

/** Validates a GitHub App installation id before it is converted for the SDK. */
const installationIdToNumber = (
  installationId: string
): Effect.Effect<number, IntegrationProviderInvalidConfigurationError> =>
  GITHUB_INSTALLATION_ID_PATTERN.test(installationId)
    ? Effect.succeed(Number(installationId))
    : Effect.fail(
        new IntegrationProviderInvalidConfigurationError({
          message: "GitHub App installation id is invalid",
          provider: githubProviderKey,
        })
      );

/** Creates a GitHub adapter backed by the Effect-native @distilled.cloud/github SDK. */
export const makeGitHubApiClient = (): GitHubApiClient => {
  const exchangeUserAccessToken = ({
    clientId,
    clientSecret,
    code,
  }: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly code: string;
  }): Effect.Effect<GitHubUserAccessToken, GitHubApiFailure> =>
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
      const response = yield* HttpClient.execute(httpRequest).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError(
          () =>
            new IntegrationProviderTemporaryFailure({
              message: "GitHub request failed during setup user-token exchange",
              provider: githubProviderKey,
            })
        ),
        Effect.timeoutOrElse({
          duration: GITHUB_API_REQUEST_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new IntegrationProviderTemporaryFailure({
                message:
                  "GitHub request timed out during setup user-token exchange",
                provider: githubProviderKey,
              })
            ),
        })
      );
      if (response.status < 200 || response.status >= 300) {
        return yield* classifyGitHubApiError(
          { headers: response.headers, status: response.status },
          "setup user-token exchange"
        );
      }
      const body = yield* response.json.pipe(
        Effect.mapError(
          () =>
            new IntegrationProviderPermanentRejection({
              message:
                "GitHub returned an invalid response during setup user-token exchange",
              provider: githubProviderKey,
              httpStatus: response.status,
            })
        )
      );
      return yield* decodeSdkResponse(
        GitHubUserAccessToken,
        "setup user-token exchange"
      )(body);
    });

  return {
    createIssueBacklinkComment: ({
      accessToken,
      backlinkUrl,
      issueNumber,
      repositoryName,
      repositoryOwner,
    }) =>
      withSdk(
        accessToken,
        GitHub.Retry.none(
          GitHub.Services.issues.createComment({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
            body: renderGitHubIssueBacklinkComment({ backlinkUrl }),
          })
        ),
        "issue backlink comment"
      ).pipe(Effect.asVoid),
    createIssue: ({
      accessToken,
      body,
      repositoryName,
      repositoryOwner,
      title,
    }) =>
      withSdk(
        accessToken,
        GitHub.Retry.none(
          GitHub.Services.issues.create({
            owner: repositoryOwner,
            repo: repositoryName,
            title,
            body,
          })
        ),
        "issue creation"
      ).pipe(
        Effect.flatMap((issue) =>
          decodeSdkResponse(GitHubIssue, "issue creation")(issue)
        )
      ),
    createInstallationAccessToken: ({ appJwt, installationId }) =>
      installationIdToNumber(installationId).pipe(
        Effect.flatMap((installation_id) =>
          withSdk(
            appJwt,
            GitHub.Retry.none(
              GitHub.Services.apps.createInstallationAccessToken({
                installation_id,
              })
            ),
            "installation token creation"
          ).pipe(
            Effect.flatMap((token) =>
              decodeSdkResponse(
                GitHubInstallationAccessToken,
                "installation token creation"
              )({
                expires_at: token.expires_at,
                token: token.token,
              })
            )
          )
        )
      ),
    deleteInstallation: ({ appJwt, installationId }) =>
      installationIdToNumber(installationId).pipe(
        Effect.flatMap((installation_id) =>
          withSdk(
            appJwt,
            GitHub.Retry.none(
              GitHub.Services.apps.deleteInstallation({
                installation_id,
              })
            ),
            "installation removal"
          ).pipe(
            Effect.catchIf(
              (error) =>
                Schema.is(IntegrationProviderInvalidConfigurationError)(
                  error
                ) &&
                (error.httpStatus === 404 || error.httpStatus === 410),
              () => Effect.void
            )
          )
        )
      ),
    exchangeUserAccessToken,
    getIssue: ({ accessToken, issueNumber, repositoryName, repositoryOwner }) =>
      withSdk(
        accessToken,
        GitHub.Retry.none(
          GitHub.Services.issues.get({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
          })
        ),
        "issue lookup"
      ).pipe(
        Effect.flatMap((issue) =>
          decodeSdkResponse(GitHubIssue, "issue lookup")(issue)
        )
      ),
    listInstallationRepositories: ({ accessToken, page }) =>
      withSdk(
        accessToken,
        GitHub.Retry.none(
          GitHub.Services.apps.listReposAccessibleToInstallation({
            per_page: 100,
            page,
          })
        ),
        "installation repository listing"
      ).pipe(
        Effect.flatMap((response) =>
          decodeSdkResponse(
            GitHubInstallationRepositories,
            "installation repository listing"
          )({
            repositories: response.repositories.map((repository) => ({
              full_name: repository.full_name,
              id: repository.id,
              name: repository.name,
              owner: { login: repository.owner.login },
              private: repository.private,
            })),
            total_count: response.total_count,
          })
        )
      ),
    listUserInstallations: ({ accessToken, page }) =>
      withSdk(
        accessToken,
        GitHub.Retry.none(
          GitHub.Services.apps.listInstallationsForAuthenticatedUser({
            per_page: 100,
            page,
          })
        ),
        "setup user installation listing"
      ).pipe(
        Effect.flatMap((response) =>
          decodeSdkResponse(
            GitHubUserInstallations,
            "setup user installation listing"
          )({
            installations: response.installations.map((installation) => {
              const account = installation.account;
              if (account === null) {
                return {
                  account: null,
                  id: installation.id,
                  repository_selection: installation.repository_selection,
                  suspended_at: installation.suspended_at,
                };
              }
              const isUserAccount = "login" in account;
              return {
                account: {
                  id: account.id,
                  login: isUserAccount ? account.login : account.slug,
                  type: isUserAccount ? account.type : "Organization",
                },
                id: installation.id,
                repository_selection: installation.repository_selection,
                suspended_at: installation.suspended_at,
              };
            }),
            total_count: response.total_count,
          })
        )
      ),
  };
};
