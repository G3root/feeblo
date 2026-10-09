import { currentDb, Database, schema } from "@feeblo/db";
import { pickDefaultPostStatus } from "@feeblo/domain-contracts/post-status-default";
import { DiscordInboundFailure } from "@feeblo/domain/integration/discord/errors";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { PostWriteService } from "@feeblo/domain/post/write";
import { PostId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
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
  never,
  Database.Database | PostStatusRepository | PostWriteService
> = Layer.effect(
  DiscordFeedbackService,
  Effect.gen(function* () {
    const db = yield* currentDb;
    const postStatusRepository = yield* PostStatusRepository;
    const writes = yield* PostWriteService;

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
        const defaultStatus = pickDefaultPostStatus(statuses);
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
        // attributes the post to their feeblo user row; that synthetic inbox
        // is never subscribed.
        const id = yield* PostId.generate;
        const slug = yield* writes.create(
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
          { creatorUserId: userId }
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
);
