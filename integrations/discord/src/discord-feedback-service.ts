import { currentDb, Database, schema } from "@feeblo/db";
import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { EmailOutboxRepository } from "@feeblo/domain/email-outbox/repository";
import { EmailSubscriptionRepository } from "@feeblo/domain/email-subscription/repository";
import { ResolvePrincipalService } from "@feeblo/domain/identity/service";
import { DiscordInboundFailure } from "@feeblo/domain/integration/discord/errors";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { InvalidPostEmbeddingConfigurationError } from "@feeblo/domain/post/embedding-service";
import { PostRepository } from "@feeblo/domain/post/repository";
import { makePostWrites, PostWriteInternals } from "@feeblo/domain/post/write";
import { S3UploadService } from "@feeblo/domain/services/s3";
import { UserRepository } from "@feeblo/domain/user/repository";
import { PostId } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { and, eq } from "drizzle-orm";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** A feedback post created from an inbound Discord submission. */
export interface DiscordPost {
  readonly boardId: string;
  readonly boardName: string;
  readonly boardSlug: string;
  readonly id: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly slug: string;
  readonly status: string;
  readonly title: string;
}

export interface DiscordPostInput {
  readonly boardId: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly organizationId: string;
  readonly title: string;
  readonly userId: string;
}

/**
 * Creates a feedback post from an inbound Discord submission through the
 * shared post write path: the sanitizer, the timeline entry, the integration
 * event, the staff notification, the submission email window, the creator's
 * watch-list subscription, and the search embedding are one work whichever
 * credential asked.
 */
export interface DiscordFeedbackServiceContract {
  readonly createPost: (
    input: DiscordPostInput
  ) => Effect.Effect<DiscordPost, DiscordInboundFailure>;
}

export class DiscordFeedbackService extends Context.Service<
  DiscordFeedbackService,
  DiscordFeedbackServiceContract
>()("@feeblo/DiscordFeedbackService") {}

export const DiscordFeedbackServiceLive: Layer.Layer<
  DiscordFeedbackService,
  Config.ConfigError | InvalidPostEmbeddingConfigurationError,
  | Crypto.Crypto
  | Database.Database
  | EmailOutboxConfig
  | PostStatusRepository
  | S3UploadService
> = Layer.effect(
  DiscordFeedbackService,
  Effect.gen(function* () {
    const db = yield* currentDb;
    const postStatusRepository = yield* PostStatusRepository;
    const emailOutboxConfig = yield* EmailOutboxConfig;
    // The shared post write path reads several services from the running
    // fiber's context (the sanitizer's asset promotion, the integration event
    // recorder, the on-behalf identity resolver). The composition provides
    // the repositories through `PostWriteInternals`; this service closes over
    // the runtime-context instances and provides them around the write, the
    // way the Public API's own post repository does, so `createPost` carries
    // no requirements of its own.
    const crypto = yield* Crypto.Crypto;
    const emailOutboxRepository = yield* EmailOutboxRepository;
    const emailSubscriptions = yield* EmailSubscriptionRepository;
    const integrationEventRecorder = yield* IntegrationEventRecorder;
    const postRepository = yield* PostRepository;
    const resolvePrincipal = yield* ResolvePrincipalService;
    const s3 = yield* S3UploadService;
    const userRepository = yield* UserRepository;
    const writes = yield* makePostWrites;

    const providePostWriteEnvironment = <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ) =>
      effect.pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(Database.Database, db),
        Effect.provideService(EmailOutboxConfig, emailOutboxConfig),
        Effect.provideService(EmailOutboxRepository, emailOutboxRepository),
        Effect.provideService(EmailSubscriptionRepository, emailSubscriptions),
        Effect.provideService(
          IntegrationEventRecorder,
          integrationEventRecorder
        ),
        Effect.provideService(PostRepository, postRepository),
        Effect.provideService(ResolvePrincipalService, resolvePrincipal),
        Effect.provideService(S3UploadService, s3),
        Effect.provideService(UserRepository, userRepository)
      );

    const createPost = ({
      boardId,
      content,
      metadata = {},
      organizationId,
      title,
      userId,
    }: DiscordPostInput) =>
      Effect.gen(function* () {
        const statuses = yield* postStatusRepository.findMany({
          organizationId,
        });
        const defaultStatus = statuses[0];
        if (defaultStatus === undefined) {
          return yield* new DiscordInboundFailure({
            message: "Organization has no default post status",
          });
        }
        const [board] = yield* db
          .select({
            name: schema.boardTable.name,
            slug: schema.boardTable.slug,
          })
          .from(schema.boardTable)
          .where(
            and(
              eq(schema.boardTable.id, boardId),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .limit(1);
        if (board === undefined) {
          return yield* new DiscordInboundFailure({
            message: "Discord post board was not found",
          });
        }
        // The write path sanitizes, owns the transaction, records the timeline
        // entry and integration event, notifies staff, opens the submission
        // email window, and schedules the embedding. The inbound author has no
        // contact row to attribute through, so the write's creator option
        // watch-lists them instead; a Discord user's feeblo inbox is
        // synthetic, so no email subscription is requested from here.
        const id = yield* PostId.generate;
        const slug = yield* providePostWriteEnvironment(
          writes.create(
            {
              assetIds: [],
              boardId,
              content,
              id,
              metadata: { ...metadata },
              organizationId,
              source: "DISCORD",
              statusId: defaultStatus.id,
              title,
            },
            { kind: "api_key" },
            { subscribeCreatorUserId: userId }
          )
        );
        return {
          boardId,
          boardName: board.name,
          boardSlug: board.slug,
          id,
          metadata,
          slug,
          status: defaultStatus.type,
          title,
        };
      }).pipe(
        Effect.mapError((error) =>
          error instanceof DiscordInboundFailure
            ? error
            : new DiscordInboundFailure({
                message: "Could not create the Discord feedback post",
              })
        )
      );

    return DiscordFeedbackService.of({ createPost });
  })
).pipe(
  // Construction-time dependencies of the write environment above.
  Layer.provide(PostWriteInternals)
);
