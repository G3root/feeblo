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
import {
  DiscordFeedbackServiceLive,
  DiscordInboundServiceLive,
  DiscordIntegrationConfig,
  DiscordManagementServiceLive,
  DiscordUserServiceLive,
} from "@feeblo/domain/integration/discord";
import {
  ExternalResourceService,
  type ExternalResourceServiceContract,
} from "@feeblo/domain/integration/external-resource/service";
import { GitHubIntegrationConfig } from "@feeblo/domain/integration/github/config";
import { GitHubInboundServiceLive } from "@feeblo/domain/integration/github/inbound-live";
import { GitHubManagementServiceLive } from "@feeblo/domain/integration/github/management-live";
import {
  SlackFeedbackServiceLive,
  SlackInboundServiceLive,
  SlackIntegrationConfig,
  SlackManagementServiceLive,
  SlackUserServiceLive,
} from "@feeblo/domain/integration/slack";
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
import type { Mailer } from "@feeblo/transactional/mailer";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as Ref from "effect/Ref";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";

import { ServerConfig, type ServerConfigValue } from "../config";
import { GitHubProviderLive } from "../github-provider";
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
  workflowLayer,
}: {
  readonly config: ServerConfigValue;
  /** Single shared instance built by the composition root. */
  readonly externalResourceService: ExternalResourceServiceContract;
  readonly gitHubConfigLayer: Layer.Layer<GitHubIntegrationConfig>;
  readonly integrationRuntime: IntegrationRuntime;
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
      Layer.provide(SlackIntegrationConfig.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    SlackInboundServiceLive.pipe(
      Layer.provide(SlackIntegrationConfig.layer),
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
      Layer.provide(DiscordIntegrationConfig.layer),
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
        GitHubProviderLive.pipe(
          Layer.provide(gitHubConfigLayer),
          Layer.provide(Layer.succeed(ServerConfig, config)),
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
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ).pipe(Layer.provideMerge(Database.DatabaseContextLive));
};
