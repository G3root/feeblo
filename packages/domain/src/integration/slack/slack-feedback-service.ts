import { currentDb, Database, schema } from "@feeblo/db";
import { asLegid, IntegrationEventId, PostId, WorkspaceId } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailOutboxConfig } from "../../email-outbox/config";
import {
  PostEmbeddingService,
  schedulePostEmbeddingBestEffort,
} from "../../post/embedding-service";
import { PostRepository } from "../../post/repository";
import { PostStatusRepository } from "../../post-status/repository";
import { PostSubscriptionRepository } from "../../post-subscription/repository";
import { SlackInboundFailure } from "./errors";

/** A feedback post created from an inbound Slack submission. */
export interface SlackPost {
  readonly boardId: string;
  readonly boardSlug: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

export interface SlackPostInput {
  readonly boardId: string;
  readonly content: string;
  readonly organizationId: string;
  readonly title: string;
  readonly userId: string;
}

/**
 * Creates a feedback post from an inbound Slack submission: sanitizes the
 * content, records the integration event, subscribes the author, and schedules
 * best-effort embedding.
 */
export interface SlackFeedbackServiceShape {
  readonly createPost: (
    input: SlackPostInput
  ) => Effect.Effect<SlackPost, SlackInboundFailure>;
}

export class SlackFeedbackService extends Context.Service<
  SlackFeedbackService,
  SlackFeedbackServiceShape
>()("@feeblo/SlackFeedbackService") {}

export const makeSlackFeedbackServiceLive = (): Layer.Layer<
  SlackFeedbackService,
  never,
  | Database.Database
  | EmailOutboxConfig
  | IntegrationEventRecorder
  | PostRepository
  | PostStatusRepository
  | PostSubscriptionRepository
> =>
  Layer.effect(
    SlackFeedbackService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const postRepository = yield* PostRepository;
      const postStatusRepository = yield* PostStatusRepository;
      const postSubscriptionRepository = yield* PostSubscriptionRepository;
      const emailOutboxConfig = yield* EmailOutboxConfig;
      const eventRecorder = yield* IntegrationEventRecorder;
      const embeddingService =
        yield* Effect.serviceOption(PostEmbeddingService);

      // Inlined variant of the shared post-event recorder: same canonical
      // event, but every dependency is captured as a value so the service
      // methods stay requirement-free.
      const recordSlackPostIntegrationEvent = ({
        board,
        organizationId,
        postId,
        postSlug,
        statusId,
        title,
      }: {
        readonly board: {
          readonly id: string;
          readonly name: string;
          readonly slug: string;
        };
        readonly organizationId: string;
        readonly postId: string;
        readonly postSlug: string;
        readonly statusId: string;
        readonly title: string;
      }) =>
        Effect.gen(function* () {
          const statusType = yield* postRepository.findStatusType({
            id: statusId,
            organizationId,
          });
          if (statusType === undefined) {
            return yield* new SlackInboundFailure({
              message: "Slack post status was not found",
            });
          }
          const eventId = yield* IntegrationEventId.generate;
          const correlationId = yield* IntegrationEventId.generate;
          const url = new URL(
            `/${encodeURIComponent(organizationId)}/post/${encodeURIComponent(board.slug)}/${encodeURIComponent(postSlug)}`,
            emailOutboxConfig.appUrl
          ).href;
          yield* eventRecorder
            .recordIntegrationEvent({
              event: {
                causalHopCount: 0,
                correlationId,
                data: {
                  actor: { kind: "end_user" },
                  board,
                  post: {
                    id: postId,
                    status: { id: statusId, type: statusType },
                    title,
                    url,
                  },
                },
                id: eventId,
                occurredAt: yield* DateTime.now,
                organizationId: asLegid(WorkspaceId)(organizationId),
                origin: { kind: "feeblo" },
                type: "feedback.post.created",
                version: 1,
              },
            })
            .pipe(
              Effect.mapError(
                () =>
                  new SlackInboundFailure({
                    message: "Could not record post integration event",
                  })
              )
            );
        });

      const createPost = ({
        boardId,
        content,
        organizationId,
        title,
        userId,
      }: SlackPostInput) =>
        Effect.gen(function* () {
          const statuses = yield* postStatusRepository.findMany({
            organizationId,
          });
          const defaultStatus = statuses[0];
          if (defaultStatus === undefined) {
            return yield* new SlackInboundFailure({
              message: "Organization has no default post status",
            });
          }
          const { sanitizedMarkdown, sanitizedHtml } =
            sanitizeMarkdown(content);
          const id = yield* PostId.generate;
          const excerpt = htmlToExcerpt(sanitizedHtml);
          const [board] = yield* db
            .select({
              id: schema.boardTable.id,
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
            return yield* new SlackInboundFailure({
              message: "Slack post board was not found",
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
                source: "SLACK",
                statusId: defaultStatus.id,
                title,
              });
              yield* recordSlackPostIntegrationEvent({
                board,
                organizationId,
                postId: id,
                postSlug: createdSlug,
                statusId: defaultStatus.id,
                title,
              });
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
            error instanceof SlackInboundFailure
              ? error
              : new SlackInboundFailure({
                  message: "Could not create the Slack feedback post",
                })
          )
        );

      return SlackFeedbackService.of({ createPost });
    })
  );

/** Live layer with real repositories and the default database context. */
export const SlackFeedbackServiceLive = makeSlackFeedbackServiceLive();
