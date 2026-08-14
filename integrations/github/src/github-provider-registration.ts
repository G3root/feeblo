import {
  type IntegrationInboundCapabilityHandler,
  type IntegrationInboundRequest,
  type IntegrationInboundResponse,
  IntegrationPostEventData,
  type IntegrationProviderDeliveryInput,
  IntegrationProviderInvalidConfigurationError,
  type IntegrationProviderRegistration,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { type GitHubApiClient, makeGitHubApiClient } from "./github-api";
import type { GitHubInstallationTokenResolver } from "./github-app-auth";
import { GitHubInboundPayloadError } from "./github-errors";
import { makeGitHubIssueExternalResourceDraft } from "./github-external-resource";
import {
  GitHubInstallationRepositoriesWebhookPayload,
  GitHubInstallationWebhookPayload,
  GitHubIssueWebhookPayload,
  type ParsedGitHubInboundRequest,
} from "./github-inbound-schema";
import { renderGitHubIssueBody } from "./github-issue-body";
import {
  GitHubConnectionConfiguration,
  GitHubIssueCreateRouteConfiguration,
  GitHubIssueWebhookRouteConfiguration,
  githubIssueCreateCapabilityKey,
  githubIssueWebhookCapabilityKey,
  githubProviderKey,
  githubProviderManifest,
} from "./github-manifest";
import { verifyGitHubWebhookSignature } from "./github-signature";

/** Per-connection GitHub App token resolver; durable ciphertext contains only installation identity. */
export interface GitHubProviderCredentialResolver {
  readonly loadGitHubCredentials: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    { readonly accessToken: Redacted.Redacted<string> },
    | IntegrationProviderInvalidConfigurationError
    | IntegrationProviderTemporaryFailure
  >;
}

export const makeGitHubCredentialResolver = ({
  installationTokenResolver,
  loadInstallationId,
}: {
  readonly installationTokenResolver: GitHubInstallationTokenResolver;
  readonly loadInstallationId: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<string | null, IntegrationProviderTemporaryFailure>;
}): GitHubProviderCredentialResolver => ({
  loadGitHubCredentials: (input) =>
    Effect.gen(function* () {
      const installationId = yield* loadInstallationId(input);
      if (installationId === null) {
        return yield* new IntegrationProviderInvalidConfigurationError({
          message: "GitHub credentials are unavailable",
          provider: githubProviderKey,
        });
      }
      const accessToken = yield* installationTokenResolver
        .getInstallationAccessToken({
          installationId,
        })
        .pipe(
          Effect.mapError((error) =>
            Schema.is(IntegrationProviderInvalidConfigurationError)(error)
              ? error
              : new IntegrationProviderTemporaryFailure({
                  message: "GitHub installation token could not be minted",
                  provider: githubProviderKey,
                })
          )
        );
      return { accessToken };
    }),
});

const parseGitHubAppWebhook = ({
  deliveryId,
  eventName,
  rawBody,
}: {
  readonly deliveryId: string | undefined;
  readonly eventName: string | undefined;
  readonly rawBody: string;
}): Effect.Effect<ParsedGitHubInboundRequest, GitHubInboundPayloadError> => {
  if (deliveryId === undefined || deliveryId.length === 0) {
    return Effect.fail(
      new GitHubInboundPayloadError({
        reason: "GitHub webhook delivery id is missing",
      })
    );
  }
  switch (eventName) {
    case "issues":
      return Schema.decodeUnknownEffect(
        Schema.fromJsonString(GitHubIssueWebhookPayload)
      )(rawBody).pipe(
        Effect.map((payload) => ({
          deliveryId,
          kind: "issue" as const,
          payload,
        })),
        Effect.mapError(
          () =>
            new GitHubInboundPayloadError({
              reason: "GitHub App webhook payload is invalid",
            })
        )
      );
    case "installation":
      return Schema.decodeUnknownEffect(
        Schema.fromJsonString(GitHubInstallationWebhookPayload)
      )(rawBody).pipe(
        Effect.map((payload) => ({
          deliveryId,
          kind: "installation" as const,
          payload,
        })),
        Effect.mapError(
          () =>
            new GitHubInboundPayloadError({
              reason: "GitHub App webhook payload is invalid",
            })
        )
      );
    case "installation_repositories":
      return Schema.decodeUnknownEffect(
        Schema.fromJsonString(GitHubInstallationRepositoriesWebhookPayload)
      )(rawBody).pipe(
        Effect.map((payload) => ({
          deliveryId,
          kind: "installation_repositories" as const,
          payload,
        })),
        Effect.mapError(
          () =>
            new GitHubInboundPayloadError({
              reason: "GitHub App webhook payload is invalid",
            })
        )
      );
    default:
      return Effect.fail(
        new GitHubInboundPayloadError({
          reason: "GitHub App webhook event is unsupported",
        })
      );
  }
};

/** Converts a GitHub issue into the provider-neutral resource draft; both delivery and user-requested paths share this mapping. */

/** Provider-owned raw GitHub App webhook authentication and decoding, before any domain service runs. */
const makeGitHubAppWebhookHandler = ({
  webhookSecret,
}: {
  readonly webhookSecret: Redacted.Redacted<string>;
}): IntegrationInboundCapabilityHandler => ({
  capabilityKey: githubIssueWebhookCapabilityKey,
  handle: (input: IntegrationInboundRequest) =>
    Effect.gen(function* () {
      const verified = yield* Effect.result(
        verifyGitHubWebhookSignature({
          rawBody: input.rawBody,
          signatureHeader: input.headers["x-hub-signature-256"],
          webhookSecret,
        })
      );
      if (Result.isFailure(verified)) {
        return {
          body: "invalid request signature",
          status: 401,
        } satisfies IntegrationInboundResponse;
      }
      const parsed = yield* Effect.result(
        parseGitHubAppWebhook({
          deliveryId: input.headers["x-github-delivery"],
          eventName: input.headers["x-github-event"],
          rawBody: input.rawBody,
        })
      );
      if (Result.isFailure(parsed)) {
        return parsed.failure.reason ===
          "GitHub App webhook event is unsupported"
          ? ({
              body: "unsupported GitHub webhook event",
              status: 202,
            } satisfies IntegrationInboundResponse)
          : ({
              body: "invalid request payload",
              status: 400,
            } satisfies IntegrationInboundResponse);
      }
      return {
        body: parsed.success,
        status: 200,
      } satisfies IntegrationInboundResponse;
    }),
});

/** GitHub has one outbound issue-create capability and one separate inbound webhook capability. */
export const makeGitHubProviderRegistration = ({
  apiClient = makeGitHubApiClient(),
  credentialResolver,
  webhookSecret,
}: {
  readonly apiClient?: GitHubApiClient;
  readonly credentialResolver: GitHubProviderCredentialResolver;
  readonly webhookSecret: Redacted.Redacted<string>;
}): IntegrationProviderRegistration => {
  const issueCreateHandler = {
    capabilityKey: githubIssueCreateCapabilityKey,
    deliver: (input: IntegrationProviderDeliveryInput) =>
      Effect.gen(function* () {
        if (input.event.type !== "feedback.post.created") {
          return yield* new IntegrationProviderInvalidConfigurationError({
            message: "GitHub issue creation only supports new posts",
            provider: githubProviderKey,
          });
        }
        const routeConfig = yield* Schema.decodeUnknownEffect(
          GitHubIssueCreateRouteConfiguration
        )(input.route.providerConfig).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "GitHub issue route configuration is invalid",
                provider: githubProviderKey,
              })
          )
        );
        const eventData = yield* Schema.decodeUnknownEffect(
          IntegrationPostEventData
        )(input.event.data).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "GitHub event payload is invalid",
                provider: githubProviderKey,
              })
          )
        );
        // The route's board selection is intentionally checked by the provider
        // rather than broadening the kernel event selection model.
        if (
          routeConfig.boardId !== undefined &&
          routeConfig.boardId !== eventData.board.id
        ) {
          return {};
        }
        const credentials =
          yield* credentialResolver.loadGitHubCredentials(input);
        const issue = yield* apiClient.createIssue({
          accessToken: credentials.accessToken,
          body: renderGitHubIssueBody({
            description: eventData.post.description ?? null,
          }),
          repositoryName: routeConfig.repositoryName,
          repositoryOwner: routeConfig.repositoryOwner,
          title: eventData.post.title,
        });
        // The bot backlink comment is part of the delivery so a retry after a
        // crash before acknowledgement re-runs both calls (at-least-once).
        yield* apiClient.createIssueBacklinkComment({
          accessToken: credentials.accessToken,
          backlinkUrl: eventData.post.url,
          issueNumber: issue.number,
          repositoryName: routeConfig.repositoryName,
          repositoryOwner: routeConfig.repositoryOwner,
        });
        return {
          externalResourceDrafts: [
            makeGitHubIssueExternalResourceDraft({
              issueNumber: issue.number,
              postId: eventData.post.id,
              repositoryName: routeConfig.repositoryName,
              repositoryOwner: routeConfig.repositoryOwner,
              remoteId: issue.node_id,
              remoteUrl: issue.html_url,
              state: issue.state,
              title: issue.title,
            }),
          ],
          httpStatus: 201,
        };
      }),
  };
  return {
    connectionConfigurationSchema: GitHubConnectionConfiguration,
    handlers: [issueCreateHandler],
    inboundHandlers: [makeGitHubAppWebhookHandler({ webhookSecret })],
    manifest: githubProviderManifest,
    routeConfigurationSchemas: new Map([
      [githubIssueCreateCapabilityKey, GitHubIssueCreateRouteConfiguration],
      [githubIssueWebhookCapabilityKey, GitHubIssueWebhookRouteConfiguration],
    ]),
  };
};
