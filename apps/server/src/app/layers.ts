import { NodeRedis } from "@effect/platform-node";
import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import { BoardRepository } from "@feeblo/domain/board/repository";
import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { EmailOutboxRepository } from "@feeblo/domain/email-outbox/repository";
import { EmailProviderFeedbackConfig } from "@feeblo/domain/email-provider-feedback/config";
import { EmailProviderFeedbackService } from "@feeblo/domain/email-provider-feedback/service";
import { SesEmailFeedbackWebhook } from "@feeblo/domain/email-provider-feedback/ses-webhook";
import { EmailSubscriptionRepository } from "@feeblo/domain/email-subscription/repository";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import {
  ExternalResourceService,
  type ExternalResourceServiceContract,
} from "@feeblo/domain/integration/external-resource/service";
import { GitHubIntegrationConfig } from "@feeblo/domain/integration/github/config";
import { SlackInboundServiceLive } from "@feeblo/integration-slack/inbound-live";
import { SlackManagementServiceLive } from "@feeblo/integration-slack/management-live";
import { DISCORD_OAUTH_PERMISSIONS, DISCORD_OAUTH_SCOPES } from "@feeblo/integration-discord/manifest";
import { SLACK_OAUTH_SCOPES } from "@feeblo/integration-slack/manifest";
import { SlackFeedbackServiceLive } from "@feeblo/integration-slack/slack-feedback-service";
import { SlackUserServiceLive } from "@feeblo/integration-slack/slack-user-service";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import { NotificationService } from "@feeblo/domain/notification/service";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { PostSubscriptionRepository } from "@feeblo/domain/post-subscription/repository";
import { PostRepository } from "@feeblo/domain/post/repository";
import { RateLimitService } from "@feeblo/domain/rate-limit/service";
import { Auth } from "@feeblo/domain/session-middleware";
import { SiteRepository } from "@feeblo/domain/site/repository";
import { makeWorkflowsTest, WorkflowsLive } from "@feeblo/domain/workflows";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import { DiscordFeedbackServiceLive } from "@feeblo/integration-discord/discord-feedback-service";
import { DiscordUserServiceLive } from "@feeblo/integration-discord/discord-user-service";
import { DiscordInboundServiceLive } from "@feeblo/integration-discord/inbound-live";
import { DiscordManagementServiceLive } from "@feeblo/integration-discord/management-live";
import { GitHubInboundServiceLive } from "@feeblo/integration-github/github-inbound-live";
import { GitHubManagementServiceLive } from "@feeblo/integration-github/github-management-live";
import { makeGitHubProviderLive } from "@feeblo/integration-github/github-provider-live";
import type { Mailer } from "@feeblo/transactional/mailer";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as Ref from "effect/Ref";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";

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

export const makeRateLimitLayer = (
  config: ServerConfigValue,
  useTestMailer: boolean
): Layer.Layer<RateLimitService> => {
  const memoryStore = RateLimiter.layerStoreMemory;

  const RateLimitStoreLayer: Layer.Layer<RateLimiter.RateLimiterStore> =
    useTestMailer || config.nodeEnv === "test"
      ? memoryStore
      : config.redisUrl !== undefined
        ? RateLimiter.layerStoreRedis({ prefix: "feeblo:rate-limit" }).pipe(
            Layer.provide(NodeRedis.layer(redisOptions(config.redisUrl)))
          )
        : config.nodeEnv === "development"
          ? memoryStore
          : memoryStore.pipe(
              Layer.tap(() =>
                Effect.logWarning(
                  "REDIS_URL is not set: falling back to in-memory rate limiting, " +
                    "which is not shared across server instances. Configure " +
                    "REDIS_URL for production deployments."
                )
              )
            );

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
  rateLimitLayer: Layer.Layer<RateLimitService>
) => Layer.effect(Auth, initAuthHandler(makeMailerLayer, rateLimitLayer));

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
  return Layer.mergeAll(
    workflowLayer,
    SiteRepository.layer,
    EmailOutboxRepository.layer,
    EmailProviderFeedbackConfig.layer,
    EmailProviderFeedbackService.layer,
    SesEmailFeedbackWebhook.layer.pipe(
      Layer.provide(EmailProviderFeedbackService.layer),
      Layer.provide(EmailProviderFeedbackConfig.layer),
      Layer.provide(FetchHttpClient.layer)
    ),
    EmailSubscriptionRepository.layer,
    integrationRuntime.layer,
    ExternalResources,
    SlackManagementServiceLive.pipe(
      Layer.provide(slackConfigLayer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    SlackInboundServiceLive.pipe(
      Layer.provide(slackConfigLayer),
      Layer.provide(SlackUserServiceLive),
      Layer.provide(SlackFeedbackServiceLive),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(PostSubscriptionRepository.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordManagementServiceLive.pipe(
      Layer.provide(discordConfigLayer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordInboundServiceLive.pipe(
      Layer.provide(DiscordUserServiceLive),
      Layer.provide(DiscordFeedbackServiceLive),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(PostSubscriptionRepository.layer),
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
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
    WorkspaceRepository.layer
  ).pipe(Layer.provideMerge(Database.DatabaseContextLive));
};
