import { NodeRedis } from "@effect/platform-node";
import { toAuthHandler } from "@feeblo/auth/auth-handler";
import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import { AssetRepository } from "@feeblo/domain/asset/repository";
import { BoardRepository } from "@feeblo/domain/board/repository";
import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { EmailOutboxRepository } from "@feeblo/domain/email-outbox/repository";
import { EmailProviderFeedbackConfig } from "@feeblo/domain/email-provider-feedback/config";
import { EmailProviderFeedbackService } from "@feeblo/domain/email-provider-feedback/service";
import { SesEmailFeedbackWebhook } from "@feeblo/domain/email-provider-feedback/ses-webhook";
import { EmailSubscriptionRepository } from "@feeblo/domain/email-subscription/repository";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { ResolvePrincipalService } from "@feeblo/domain/identity/service";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import {
  ExternalResourceService,
  type ExternalResourceServiceContract,
} from "@feeblo/domain/integration/external-resource/service";
import { GitHubIntegrationConfig } from "@feeblo/domain/integration/github/config";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import { NotificationPreferenceRepository } from "@feeblo/domain/notification-preference/repository";
import { NotificationPreferenceTokenService } from "@feeblo/domain/notification-preference/tokens";
import { NotificationService } from "@feeblo/domain/notification/service";
import { PostActivityRepository } from "@feeblo/domain/post-activity/repository";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { PostSubscriptionRepository } from "@feeblo/domain/post-subscription/repository";
import { PostEmbeddingService } from "@feeblo/domain/post/embedding-service";
import { PostRepository } from "@feeblo/domain/post/repository";
import { PostWriteService } from "@feeblo/domain/post/write";
import { PublicApiConfig } from "@feeblo/domain/public-api/config";
import { RateLimitService } from "@feeblo/domain/rate-limit/service";
import { S3UploadServiceLive } from "@feeblo/domain/services/s3";
import { Auth } from "@feeblo/domain/session-middleware";
import { SiteRepository } from "@feeblo/domain/site/repository";
import { UserRepository } from "@feeblo/domain/user/repository";
import { makeWorkflowsTest, WorkflowsLive } from "@feeblo/domain/workflows";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import { DiscordFeedbackServiceLive } from "@feeblo/integration-discord/discord-feedback-service";
import { DiscordUserServiceLive } from "@feeblo/integration-discord/discord-user-service";
import { DiscordInboundServiceLive } from "@feeblo/integration-discord/inbound-live";
import { DiscordManagementServiceLive } from "@feeblo/integration-discord/management-live";
import {
  DISCORD_OAUTH_PERMISSIONS,
  DISCORD_OAUTH_SCOPES,
} from "@feeblo/integration-discord/manifest";
import { GitHubInboundServiceLive } from "@feeblo/integration-github/github-inbound-live";
import { GitHubManagementServiceLive } from "@feeblo/integration-github/github-management-live";
import { makeGitHubProviderLive } from "@feeblo/integration-github/github-provider-live";
import { SlackInboundServiceLive } from "@feeblo/integration-slack/inbound-live";
import { SlackManagementServiceLive } from "@feeblo/integration-slack/management-live";
import { SLACK_OAUTH_SCOPES } from "@feeblo/integration-slack/manifest";
import { SlackFeedbackServiceLive } from "@feeblo/integration-slack/slack-feedback-service";
import { SlackUserServiceLive } from "@feeblo/integration-slack/slack-user-service";
import type { Mailer } from "@feeblo/transactional/mailer";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as RateLimiter from "effect/persistence/RateLimiter";
import type * as Redis from "effect/persistence/Redis";
import * as Redacted from "effect/Redacted";
import type * as Ref from "effect/Ref";

import type { ServerConfigValue } from "../config";
import { redisOptions } from "../infra/redis";
import type { IntegrationRuntime } from "../integrations";

export const makeGitHubConfigLayer = (
  config: ServerConfigValue
): Layer.Layer<GitHubIntegrationConfig> =>
  Layer.succeed(
    GitHubIntegrationConfig,
    GitHubIntegrationConfig.of({
      clientId: config.githubClientId ?? "",
      configured:
        config.githubAppId !== undefined &&
        config.githubAppSlug !== undefined &&
        config.githubClientId !== undefined &&
        Redacted.value(config.githubClientSecret) !== "" &&
        Redacted.value(config.githubPrivateKey) !== "" &&
        Redacted.value(config.githubWebhookSecret) !== "",
    })
  );

/** Builds the Slack integration configuration values from the server environment. */
export const makeSlackIntegrationConfig = (config: ServerConfigValue) => {
  const trailingSlashPattern = /\/$/;
  const appUrlValue = config.appUrl.replace(trailingSlashPattern, "");
  const apiUrlValue = config.apiUrl.replace(trailingSlashPattern, "");
  const clientId = config.slackClientId ?? "";
  const clientSecret = config.slackClientSecret;
  const signingSecret = config.slackSigningSecret;
  return SlackIntegrationConfig.of({
    appUrl: appUrlValue,
    authorizeScopes: SLACK_OAUTH_SCOPES,
    clientId,
    clientSecret,
    // The provider is only exposed when its OAuth client id, client
    // secret, and request signing secret are all configured; otherwise
    // the server runs without the Slack integration.
    configured:
      clientId !== "" &&
      Redacted.value(clientSecret) !== "" &&
      Redacted.value(signingSecret) !== "",
    encryptionKey: config.integrationEncryptionKey,
    oauthRedirectUrl:
      config.slackOauthRedirectUrl ?? `${apiUrlValue}/slack/oauth/callback`,
    signingSecret,
  });
};

export const makeSlackConfigLayer = (
  config: ServerConfigValue
): Layer.Layer<SlackIntegrationConfig> =>
  Layer.succeed(SlackIntegrationConfig, makeSlackIntegrationConfig(config));

/** Builds the Discord integration configuration values from the server environment. */
export const makeDiscordIntegrationConfig = (config: ServerConfigValue) => {
  const trailingSlashPattern = /\/$/;
  const apiUrlValue = config.apiUrl.replace(trailingSlashPattern, "");
  const clientId = config.discordClientId ?? "";
  const clientSecret = config.discordClientSecret;
  const botToken = config.discordBotToken;
  const publicKey = config.discordPublicKey ?? "";
  return DiscordIntegrationConfig.of({
    appUrl: config.appUrl.replace(trailingSlashPattern, ""),
    authorizeScopes: DISCORD_OAUTH_SCOPES,
    botToken,
    clientId,
    clientSecret,
    // The provider is only exposed when the OAuth client id, client
    // secret, bot token, and interaction public key are all configured;
    // otherwise the server runs without the Discord integration.
    configured:
      clientId !== "" &&
      Redacted.value(clientSecret) !== "" &&
      Redacted.value(botToken) !== "" &&
      publicKey !== "",
    encryptionKey: config.integrationEncryptionKey,
    oauthRedirectUrl:
      config.discordOauthRedirectUrl ?? `${apiUrlValue}/discord/oauth/callback`,
    permissions: DISCORD_OAUTH_PERMISSIONS,
    publicKey,
  });
};

/** Builds the webhook security configuration values from the server environment. */
export const makeWebhookIntegrationConfig = (config: ServerConfigValue) => {
  const environment = (() => {
    if (config.nodeEnv === "production") {
      return "production" as const;
    }
    if (config.nodeEnv === "test") {
      return "test" as const;
    }
    return "development" as const;
  })();
  return WebhookIntegrationConfig.of({
    encryptionKey: config.integrationEncryptionKey,
    endpointSecurityPolicy: {
      // The private-network override is only honored in development; in
      // every other environment the policy rejects private egress.
      allowPrivateNetworkInDevelopment:
        config.nodeEnv === "development" &&
        config.integrationAllowPrivateNetwork,
      environment,
    },
  });
};

export const makeRateLimitLayer = (
  config: ServerConfigValue
): Layer.Layer<RateLimitService, Redis.RedisError> => {
  // A configured Redis store always wins so rate limits stay shared, even
  // when the test mailer is enabled. The in-memory fallback applies only in
  // test/development: config fails startup in production without REDIS_URL,
  // so a memory store can never silently serve production traffic.
  const RateLimitStoreLayer: Layer.Layer<
    RateLimiter.RateLimiterStore,
    Redis.RedisError
  > =
    config.redisUrl !== undefined
      ? RateLimiter.layerStoreRedis({ prefix: "feeblo:rate-limit" }).pipe(
          Layer.provide(NodeRedis.layer(redisOptions(config.redisUrl)))
        )
      : RateLimiter.layerStoreMemory;

  return RateLimitService.layer.pipe(
    Layer.provide(RateLimiter.layer),
    Layer.provide(RateLimitStoreLayer)
  );
};

export const makeWorkflowLayer = (
  mailbox: Ref.Ref<TestMailerState> | undefined,
  makeMailerLayer: () => Layer.Layer<Mailer, Layer.Error<typeof Mailer.layer>>
) =>
  mailbox
    ? makeWorkflowsTest(makeMailerLayer).pipe(
        Layer.provide(Database.DatabaseContextLive)
      )
    : WorkflowsLive.pipe(
        Layer.provide(Database.DatabaseContextLive),
        Layer.provide(Database.SqlClientContextLive)
      );

export const makeAuthLayer = (
  makeMailerLayer: () => Layer.Layer<Mailer, Layer.Error<typeof Mailer.layer>>,
  rateLimitLayer: Layer.Layer<RateLimitService, Redis.RedisError>
) =>
  Layer.effect(
    Auth,
    Effect.map(initAuthHandler(makeMailerLayer, rateLimitLayer), toAuthHandler)
  );

export const makeServiceLayers = ({
  config,
  externalResourceService,
  gitHubConfigLayer,
  integrationRuntime,
  discordConfigLayer,
  slackConfigLayer,
  workflowLayer,
}: {
  readonly config: ServerConfigValue;
  /** Single shared instance built by the composition root. */
  readonly externalResourceService: ExternalResourceServiceContract;
  readonly gitHubConfigLayer: Layer.Layer<GitHubIntegrationConfig>;
  readonly integrationRuntime: IntegrationRuntime;
  readonly discordConfigLayer: Layer.Layer<DiscordIntegrationConfig>;
  readonly slackConfigLayer: Layer.Layer<SlackIntegrationConfig>;
  readonly workflowLayer: ReturnType<typeof makeWorkflowLayer>;
}) => {
  const ExternalResources = Layer.succeed(
    ExternalResourceService,
    externalResourceService
  );
  // The entitlement decision is built from the workspace's billing state and is
  // read both by the Public API's key middleware and by its changelog writes
  // (publishing emails subscribers only on a plan that includes them). One
  // value, provided once, so the two cannot disagree about a workspace.
  const EntitlementPolicies = EntitlementPolicy.layer.pipe(
    Layer.provide(WorkspaceRepository.layer)
  );
  // The shared post write path's environment, provided once: the dashboard
  // RPCs, the Public API, the widget feedback endpoint, and the Slack and
  // Discord inbound feedback services all require this one service instead of
  // restating its collaborators. A missing layer therefore fails this build's
  // type rather than one request.
  const PostWriteDependencies = Layer.mergeAll(
    BoardRepository.layer,
    EmailOutboxConfig.layer,
    EmailOutboxRepository.layer,
    EmailSubscriptionRepository.layer,
    EntitlementPolicies,
    IntegrationEventRecorderLive,
    PostActivityRepository.layer,
    PostRepository.layer,
    PostSubscriptionRepository.layer,
    ResolvePrincipalService.layer,
    S3UploadServiceLive,
    UserRepository.layer
  );
  const PostWrites = PostWriteService.layer.pipe(
    Layer.provide(PostWriteDependencies)
  );
  return Layer.mergeAll(
    workflowLayer,
    SiteRepository.layer,
    // The media-upload surfaces replace a singleton asset through the asset
    // repository; provided once here rather than rebuilt inside each handler.
    AssetRepository.layer,
    EmailOutboxRepository.layer,
    // The Public API's post writes record integration events, and the recorder
    // snapshots the post's URL into the event. Required rather than provided
    // per-layer, so the one value is built from the server's own `APP_URL` and
    // `API_URL` instead of a second read of the environment.
    EmailOutboxConfig.layer,
    EmailProviderFeedbackConfig.layer,
    EmailProviderFeedbackService.layer,
    SesEmailFeedbackWebhook.layer.pipe(
      Layer.provide(EmailProviderFeedbackService.layer),
      Layer.provide(EmailProviderFeedbackConfig.layer),
      Layer.provide(FetchHttpClient.layer)
    ),
    EmailSubscriptionRepository.layer,
    NotificationPreferenceRepository.layer,
    NotificationPreferenceTokenService.layer,
    integrationRuntime.layer,
    ExternalResources,
    SlackManagementServiceLive.pipe(
      Layer.provide(slackConfigLayer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    SlackInboundServiceLive.pipe(
      Layer.provide(slackConfigLayer),
      Layer.provide(SlackUserServiceLive),
      Layer.provide(
        SlackFeedbackServiceLive.pipe(
          Layer.provide(PostStatusRepository.layer),
          Layer.provide(PostWrites)
        )
      ),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordManagementServiceLive.pipe(
      Layer.provide(discordConfigLayer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordInboundServiceLive.pipe(
      Layer.provide(DiscordUserServiceLive),
      Layer.provide(
        DiscordFeedbackServiceLive.pipe(
          Layer.provide(PostStatusRepository.layer),
          Layer.provide(PostWrites)
        )
      ),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    GitHubManagementServiceLive.pipe(
      Layer.provide(ExternalResources),
      Layer.provide(
        makeGitHubProviderLive({
          githubAppId: config.githubAppId,
          githubAppSlug: config.githubAppSlug,
          githubClientId: config.githubClientId,
          githubClientSecret: config.githubClientSecret,
          githubPrivateKey: config.githubPrivateKey,
          githubEncryptionKey: config.integrationEncryptionKey,
        }).pipe(
          Layer.provide(gitHubConfigLayer),
          Layer.provide(Database.DatabaseContextLive)
        )
      ),
      Layer.provide(gitHubConfigLayer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    GitHubInboundServiceLive.pipe(
      Layer.provide(NotificationService.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    EntitlementPolicies,
    WorkspaceRepository.layer,
    PostWrites,
    // The write path's optional fan-outs resolve from the request context, so
    // the one instance is merged here for every surface that writes a post.
    NotificationService.layer,
    PostEmbeddingService.layer,
    // Media storage is shared rather than the Public API's own: its repository
    // sweeps the editor assets a deleted changelog entry orphaned, and the
    // dashboard's routes upload through the same service. The Public API's
    // private dependencies live in its route layer (`public-api/router.ts`),
    // so what is assembled here is what more than one surface reads.
    S3UploadServiceLive,
    // Required by the Public API's route layer (`public-api/router.ts`),
    // where the operations declare it in `PublicApiDependencies`. Dropping
    // this line fails the server's type rather than one request that asks for
    // a paging link.
    PublicApiConfig.layer
  ).pipe(Layer.provideMerge(Database.DatabaseContextLive));
};
