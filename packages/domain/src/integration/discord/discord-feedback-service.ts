import { currentDb, Database, schema } from "@feeblo/db";
import {
  asLegid,
  BoardId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailOutboxConfig } from "../../email-outbox/config";
import { recordPostIntegrationEvent } from "../../integration/post-event-recording";
import {
  PostEmbeddingService,
  schedulePostEmbeddingBestEffort,
} from "../../post/embedding-service";
import { PostRepository } from "../../post/repository";
import { PostStatusRepository } from "../../post-status/repository";
import { PostSubscriptionRepository } from "../../post-subscription/repository";
import { DiscordInboundFailure } from "./errors";

/** A feedback post created from an inbound Discord submission. */
export interface DiscordPost {
  readonly boardId: string;
  readonly boardSlug: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

export interface DiscordPostInput {
  readonly boardId: string;
  readonly content: string;
  readonly organizationId: string;
  readonly title: string;
  readonly userId: string;
}

/**
 * Creates a feedback post from an inbound Discord submission: sanitizes the
 * content, records the integration event, subscribes the author, and schedules
 * best-effort embedding.
 */
export interface DiscordFeedbackServiceShape {
  readonly createPost: (
    input: DiscordPostInput
  ) => Effect.Effect<DiscordPost, DiscordInboundFailure>;
}

export class DiscordFeedbackService extends Context.Service<
  DiscordFeedbackService,
  DiscordFeedbackServiceShape
>()("@feeblo/DiscordFeedbackService") {}

export const makeDiscordFeedbackServiceLive = (): Layer.Layer<
  DiscordFeedbackService,
  never,
  | Database.Database
  | EmailOutboxConfig
  | IntegrationEventRecorder
  | PostRepository
  | PostStatusRepository
  | PostSubscriptionRepository
> =>
  Layer.effect(
    DiscordFeedbackService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const postRepository = yield* PostRepository;
      const postStatusRepository = yield* PostStatusRepository;
      const postSubscriptionRepository = yield* PostSubscriptionRepository;
      const emailOutboxConfig = yield* EmailOutboxConfig;
      const eventRecorder = yield* IntegrationEventRecorder;
      const embeddingService =
        yield* Effect.serviceOption(PostEmbeddingService);

      const createPost = ({
        boardId,
        content,
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
          const { sanitizedMarkdown, sanitizedHtml } =
            sanitizeMarkdown(content);
          const id = yield* PostId.generate;
          const excerpt = htmlToExcerpt(sanitizedHtml);
          const [board] = yield* db
            .select({ slug: schema.boardTable.slug })
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
          const boardSlug = board.slug;
          const slug = yield* db.transaction(() =>
            Effect.gen(function* () {
              const createdSlug = yield* postRepository.create({
                boardId,
                content: sanitizedMarkdown,
                creatorId: userId,
                creatorMemberId: null,
                excerpt,
                id,
                organizationId,
                source: "DISCORD",
                statusId: defaultStatus.id,
                title,
              });
              yield* recordPostIntegrationEvent({
                actor: { kind: "end_user" },
                boardId: asLegid(BoardId)(boardId),
                eventType: "feedback.post.created",
                organizationId: asLegid(WorkspaceId)(organizationId),
                postId: id,
                postSlug: createdSlug,
                statusId: asLegid(PostStatusId)(defaultStatus.id),
                title,
              }).pipe(
                Effect.provideService(Database.Database, db),
                Effect.provideService(IntegrationEventRecorder, eventRecorder),
                Effect.provideService(EmailOutboxConfig, emailOutboxConfig),
                Effect.provideService(PostRepository, postRepository),
                Effect.mapError(
                  () =>
                    new DiscordInboundFailure({
                      message: "Could not record post integration event",
                    })
                )
              );
              yield* postSubscriptionRepository.subscribe({
                organizationId,
                postId: id,
                userId,
              });
              return createdSlug;
            })
          );
          yield* schedulePostEmbeddingBestEffort({
            content: sanitizedMarkdown,
            postId: id,
            organizationId,
            title,
            ...(embeddingService._tag === "Some"
              ? { embeddingService: embeddingService.value }
              : {}),
          }).pipe(Effect.provideService(Database.Database, db));
          return { boardId, boardSlug, id, slug, title };
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
  );

/** Live layer with real repositories and the default database context. */
export const DiscordFeedbackServiceLive = makeDiscordFeedbackServiceLive();
