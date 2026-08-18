import { currentDb, schema } from "@feeblo/db";
import { IntegrationEventId, type LegidOf } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EmailOutboxConfig } from "../email-outbox/config";
import { PostRepository } from "../post/repository";

/** Failure while assembling or recording a post integration event. */
export class PostIntegrationEventRecordingError extends Schema.TaggedError<PostIntegrationEventRecordingError>()(
  "PostIntegrationEventRecordingError",
  {
    kind: Schema.Literals(["infrastructure", "lookup", "recording"]),
    message: Schema.String,
  }
) {}

/** Safe actor facts for a post event; personal details beyond display name are excluded. */
export type PostIntegrationEventActor =
  | { readonly kind: "end_user" }
  | {
      readonly displayName?: string;
      readonly kind: "member";
      readonly memberId: string;
    };

/** Canonical facts needed to record a post-created or post-status-changed event. */
export interface PostIntegrationEventInput {
  readonly actor: PostIntegrationEventActor;
  readonly boardId: LegidOf<"BoardId">;
  /** Post body (sanitized markdown) carried only for post-created events. */
  readonly description?: string;
  readonly eventType: "feedback.post.created" | "feedback.post.status_changed";
  readonly metadata?: Readonly<Record<string, string>>;
  readonly organizationId: LegidOf<"WorkspaceId">;
  readonly postId: LegidOf<"PostId">;
  readonly postSlug: string;
  readonly previousStatusId?: LegidOf<"PostStatusId">;
  readonly statusId: LegidOf<"PostStatusId">;
  readonly title: string;
}

/**
 * Records a post integration event through the caller's current database
 * transaction, joining the board and status snapshots from the organization.
 * Used by the post RPC handlers and the public widget feedback flow.
 *
 * Fails with `PostIntegrationEventRecordingError`; `kind: "lookup"` means a
 * board or status snapshot could not be resolved, `kind: "recording"` means
 * the event itself could not be recorded, and `kind: "infrastructure"` means
 * the event could not be assembled (database, id, or time failure).
 */
export const recordPostIntegrationEvent = Effect.fn(
  "IntegrationEventRecording.recordPost"
)(
  function* (input: PostIntegrationEventInput) {
    const db = yield* currentDb;
    const recorder = yield* IntegrationEventRecorder;
    const { appUrl } = yield* EmailOutboxConfig;
    const postRepository = yield* PostRepository;

    const [board] = yield* db
      .select({
        id: schema.boardTable.id,
        name: schema.boardTable.name,
        slug: schema.boardTable.slug,
      })
      .from(schema.boardTable)
      .where(
        and(
          eq(schema.boardTable.id, input.boardId),
          eq(schema.boardTable.organizationId, input.organizationId)
        )
      )
      .limit(1);
    if (board === undefined) {
      return yield* new PostIntegrationEventRecordingError({
        kind: "lookup",
        message: "Post board was not found",
      });
    }
    const statusType = yield* postRepository.findStatusType({
      id: input.statusId,
      organizationId: input.organizationId,
    });
    if (statusType === undefined) {
      return yield* new PostIntegrationEventRecordingError({
        kind: "lookup",
        message: "Post status was not found",
      });
    }
    const previousStatusType =
      input.previousStatusId === undefined
        ? undefined
        : yield* postRepository.findStatusType({
            id: input.previousStatusId,
            organizationId: input.organizationId,
          });

    const id = yield* IntegrationEventId.generate;
    const correlationId = yield* IntegrationEventId.generate;
    const occurredAt = yield* DateTime.now;
    const url = new URL(
      `/${encodeURIComponent(input.organizationId)}/post/${encodeURIComponent(board.slug)}/${encodeURIComponent(input.postSlug)}`,
      appUrl
    ).href;
    return yield* recorder
      .recordIntegrationEvent({
        event: {
          causalHopCount: 0,
          correlationId,
          data: {
            actor: input.actor,
            board,
            post: {
              id: input.postId,
              ...(input.description === undefined ||
              input.description.length === 0
                ? {}
                : { description: input.description }),
              ...(input.metadata !== undefined &&
              Object.keys(input.metadata).length > 0
                ? { metadata: { ...input.metadata } }
                : {}),
              status: { id: input.statusId, type: statusType },
              title: input.title,
              url,
            },
            ...(input.previousStatusId !== undefined &&
            previousStatusType !== undefined
              ? {
                  previousStatus: {
                    id: input.previousStatusId,
                    type: previousStatusType,
                  },
                }
              : {}),
          },
          id,
          occurredAt,
          organizationId: input.organizationId,
          origin: { kind: "feeblo" },
          type: input.eventType,
          version: 1,
        },
      })
      .pipe(
        Effect.mapError(
          () =>
            new PostIntegrationEventRecordingError({
              kind: "recording",
              message: "Could not record integration event",
            })
        )
      );
  },
  // Infrastructure failures (database, id generation) are translated at this
  // boundary so callers only see the recording error type.
  (effect) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof PostIntegrationEventRecordingError
          ? error
          : new PostIntegrationEventRecordingError({
              kind: "infrastructure",
              message: "Post integration event could not be assembled",
            })
      )
    )
);
