import { currentDb, type Database, schema } from "@feeblo/db";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import { WebhookManagementServiceLive } from "@feeblo/domain/integration/webhook-management-live";
import type { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import { InternalServerError } from "@feeblo/domain/rpc-errors";
import {
  type IntegrationEventRecorder,
  IntegrationEventRecorderLive,
  IntegrationProviderInvalidConfigurationError,
  type IntegrationProviderRegistry,
  type IntegrationProviderRegistryValidationError,
  IntegrationProviderTemporaryFailure,
  makeIntegrationDeliveryWorkerRepository,
  makeIntegrationManagementRepository,
  makeIntegrationProviderRegistry,
  runIntegrationDeliveryWorker,
} from "@feeblo/integration-core";
import {
  makeDiscordCredentialResolver,
  makeDiscordProviderRegistration,
} from "@feeblo/integration-discord";
import {
  makeSlackCredentialResolver,
  makeSlackProviderRegistration,
} from "@feeblo/integration-slack";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import {
  decryptWebhookCredentialMaterial,
  makeWebhookProviderRegistration,
  webhookProviderKey,
} from "@feeblo/integration-webhook";
import { eq } from "drizzle-orm";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { ServerConfig } from "./config";

/** Static webhook runtime produced by the composition root: the management/recording layers, the hourly retention maintenance loop, and the scoped delivery worker. */
export interface IntegrationRuntime {
  readonly layer: Layer.Layer<
    WebhookManagementService | IntegrationEventRecorder,
    never,
    Database.Database | WebhookIntegrationConfig
  >;

  readonly maintenance: Effect.Effect<void, never, Database.Database>;
  readonly registry: IntegrationProviderRegistry;
  readonly worker: Effect.Effect<void, never, Database.Database>;
}

/**
 * Statically composed webhook kernel: provider registration, startup-validated
 * registry, scoped delivery worker, and the management service layer. The
 * management service implementation and its security config live in the domain
 * integration module; this module only wires concrete layers together.
 */
export const makeIntegrationLayers: Effect.Effect<
  IntegrationRuntime,
  IntegrationProviderRegistryValidationError | InternalServerError,
  | ServerConfig
  | Database.Database
  | WebhookIntegrationConfig
  | SlackIntegrationConfig
  | DiscordIntegrationConfig
  | Crypto.Crypto
> = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const db = yield* currentDb;
  const { encryptionKey, endpointSecurityPolicy } =
    yield* WebhookIntegrationConfig;

  const credentialResolver = {
    loadWebhookCredentials: (input: {
      readonly connection: { readonly id: string };
    }) =>
      Effect.gen(function* () {
        const [connection] = yield* db
          .select({
            ciphertext: schema.integrationConnectionTable.credentialsCiphertext,
          })
          .from(schema.integrationConnectionTable)
          .where(eq(schema.integrationConnectionTable.id, input.connection.id))
          .limit(1)
          .pipe(
            // A database failure is transient, not a credential problem:
            // classify it as retryable so the delivery policy keeps retrying
            // instead of treating it as a permanent configuration error.
            Effect.mapError(
              () =>
                new IntegrationProviderTemporaryFailure({
                  message: "Webhook credentials could not be loaded",
                  provider: webhookProviderKey,
                })
            )
          );
        if (
          connection?.ciphertext === null ||
          connection?.ciphertext === undefined
        ) {
          return yield* new IntegrationProviderInvalidConfigurationError({
            message: "Webhook credentials are unavailable",
            provider: webhookProviderKey,
          });
        }
        return yield* decryptWebhookCredentialMaterial(
          encryptionKey,
          connection.ciphertext
        ).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "Webhook credentials are invalid",
                provider: webhookProviderKey,
              })
          )
        );
      }),
  };
  const registration = makeWebhookProviderRegistration({
    credentialResolver,
    endpointSecurityPolicy,
  });
  const {
    configured: slackConfigured,
    encryptionKey: slackEncryptionKey,
    signingSecret,
  } = yield* SlackIntegrationConfig;
  const slackCredentialResolver = makeSlackCredentialResolver({
    encryptionKey: slackEncryptionKey,
    loadCiphertext: (input) =>
      Effect.gen(function* () {
        const [connection] = yield* db
          .select({
            ciphertext: schema.integrationConnectionTable.credentialsCiphertext,
          })
          .from(schema.integrationConnectionTable)
          .where(eq(schema.integrationConnectionTable.id, input.connection.id))
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderTemporaryFailure({
                  message: "Slack credentials could not be loaded",
                  provider: slackProviderKey,
                })
            )
          );
        return connection?.ciphertext ?? null;
      }),
  });
  const slackRegistration = makeSlackProviderRegistration({
    credentialResolver: slackCredentialResolver,
    signingSecret,
  });
  const {
    botToken: discordBotToken,
    configured: discordConfigured,
    publicKey: discordPublicKey,
  } = yield* DiscordIntegrationConfig;
  const discordCredentialResolver = makeDiscordCredentialResolver({
    botToken: discordBotToken,
  });
  const discordRegistration = makeDiscordProviderRegistration({
    credentialResolver: discordCredentialResolver,
    publicKey: discordPublicKey,
  });
  // Providers are only exposed when their credentials are configured;
  // otherwise the server runs with the remaining providers only.
  const registry = yield* makeIntegrationProviderRegistry([
    registration,
    ...(slackConfigured ? [slackRegistration] : []),
    ...(discordConfigured ? [discordRegistration] : []),
  ]);

  // Deliveries are claimed only for capability keys the startup-validated
  // registry actually exposes; the kernel never hardcodes a provider capability.
  const claimableCapabilityKeys = registry.manifests.flatMap((manifest) =>
    manifest.capabilities
      .filter((capability) => capability.direction === "outbound")
      .map((capability) => capability.key)
  );
  const workerRepository = yield* makeIntegrationDeliveryWorkerRepository(
    claimableCapabilityKeys
  );
  const lifecycleRepository = yield* makeIntegrationManagementRepository;
  const crypto = yield* Crypto.Crypto;
  const leaseOwner = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => `server-${uuid}`),
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Integration worker identity could not be generated",
        })
    )
  );
  const worker = runIntegrationDeliveryWorker({
    connectionConcurrency: config.integrationConnectionConcurrency,
    globalConcurrency: config.integrationGlobalConcurrency,
    leaseOwner,
    registry,
    repository: workerRepository,
  });
  return {
    layer: Layer.mergeAll(
      WebhookManagementServiceLive,
      IntegrationEventRecorderLive
    ),
    maintenance: DateTime.nowAsDate.pipe(
      Effect.flatMap((before) =>
        lifecycleRepository.cleanupRetention({ before })
      ),
      Effect.catch((error) =>
        Effect.logError("Integration retention cleanup failed", {
          error,
          errorTag: "IntegrationRetentionError",
        })
      ),
      Effect.repeat(Schedule.spaced("1 hour"))
    ),
    registry,
    worker,
  };
});
