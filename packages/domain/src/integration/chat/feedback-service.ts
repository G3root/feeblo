import { currentDb, Database, schema } from "@feeblo/db";
import { pickDefaultPostStatus } from "@feeblo/domain-contracts/post-status-default";
import { PostId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { PostStatusRepository } from "../../post-status/repository";
import { PostWriteService, type PostCreateWrite } from "../../post/write";
import { ChatInboundFailure } from "./errors";

/** The post-source value an inbound chat submission records on its post. */
export type ChatPostSource = NonNullable<PostCreateWrite["source"]>;

/** A feedback post created from an inbound chat submission. */
export interface ChatPost {
  readonly boardId: string;
  readonly boardName: string;
  readonly boardSlug: string;
  readonly id: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly slug: string;
  readonly status: string;
  readonly title: string;
}

export interface ChatPostInput {
  readonly boardId: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly organizationId: string;
  readonly source: ChatPostSource;
  readonly title: string;
  readonly userId: string;
}

/**
 * Creates a feedback post from an inbound chat submission through the shared
 * post write path: the sanitizer, the timeline entry, the integration event,
 * the staff notification, the submission email window, the creator's
 * watch-list subscription, and the search embedding are one work whichever
 * provider delivered the submission.
 */
export interface ChatFeedbackServiceContract {
  readonly createPost: (
    input: ChatPostInput
  ) => Effect.Effect<ChatPost, ChatInboundFailure>;
}

export class ChatFeedbackService extends Context.Service<
  ChatFeedbackService,
  ChatFeedbackServiceContract
>()("@feeblo/ChatFeedbackService") {}

export const ChatFeedbackServiceLive: Layer.Layer<
  ChatFeedbackService,
  never,
  Database.Database | PostStatusRepository | PostWriteService
> = Layer.effect(
  ChatFeedbackService,
  Effect.gen(function* () {
    const db = yield* currentDb;
    const postStatusRepository = yield* PostStatusRepository;
    const writes = yield* PostWriteService;

    const createPost = ({
      boardId,
      content,
      metadata = {},
      organizationId,
      source,
      title,
      userId,
    }: ChatPostInput) =>
      Effect.gen(function* () {
        const statuses = yield* postStatusRepository.findMany({
          organizationId,
        });
        const defaultStatus = pickDefaultPostStatus(statuses);
        if (defaultStatus === undefined) {
          return yield* new ChatInboundFailure({
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
          return yield* new ChatInboundFailure({
            message: "The feedback board was not found",
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
            source,
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
          Schema.is(ChatInboundFailure)(error)
            ? error
            : new ChatInboundFailure({
                message: "Could not create the chat feedback post",
              })
        )
      );

    return ChatFeedbackService.of({ createPost });
  })
);
