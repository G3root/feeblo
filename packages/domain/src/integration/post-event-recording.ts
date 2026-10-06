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

/** The post's author as it is recorded on the event: a classification, never an email. */
export type PostIntegrationEventAuthor =
  | { readonly displayName: string | null; readonly type: "member" }
  | {
      readonly displayName?: string;
      readonly externalId?: string;
      readonly id?: string;
      readonly type: "end_user";
    };

/** Canonical facts needed to record a post-created or post-status-changed event. */
export interface PostIntegrationEventInput {
  readonly actor: PostIntegrationEventActor;
  readonly boardId: LegidOf<"BoardId">;
  readonly eventType: "post.created" | "post.status_changed";
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
    const status = yield* postRepository.findStatus({
      id: input.statusId,
      organizationId: input.organizationId,
    });
    if (status === undefined) {
      return yield* new PostIntegrationEventRecordingError({
        kind: "lookup",
        message: "Post status was not found",
      });
    }
    const previousStatus =
      input.previousStatusId === undefined
        ? undefined
        : yield* postRepository.findStatus({
            id: input.previousStatusId,
            organizationId: input.organizationId,
          });
    // Every event carries the post's own snapshot, so the author and the body
    // are read here rather than re-derived at delivery time: a retry runs up
    // to 24 hours later, when the row may say something else.
    const [post] = yield* db
      .select({
        content: schema.postTable.content,
        creatorMemberId: schema.postTable.creatorMemberId,
        contactId: schema.postTable.contactId,
        memberName: schema.userTable.name,
        contactName: schema.contactTable.name,
        contactExternalId: schema.contactTable.externalId,
      })
      .from(schema.postTable)
      .leftJoin(
        schema.memberTable,
        eq(schema.memberTable.id, schema.postTable.creatorMemberId)
      )
      .leftJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.memberTable.userId)
      )
      .leftJoin(
        schema.contactTable,
        eq(schema.contactTable.id, schema.postTable.contactId)
      )
      .where(
        and(
          eq(schema.postTable.id, input.postId),
          eq(schema.postTable.organizationId, input.organizationId)
        )
      )
      .limit(1);
    if (post === undefined) {
      return yield* new PostIntegrationEventRecordingError({
        kind: "lookup",
        message: "Post was not found",
      });
    }
    // `creatorMemberId` is the same column the Public API classifies authors
    // by: a member id present means workspace staff, absent means an outside
    // end user. The column itself never leaves this function.
    const author: PostIntegrationEventAuthor =
      post.creatorMemberId === null
        ? {
            type: "end_user",
            ...(post.contactName !== null && {
              displayName: post.contactName,
            }),
            ...(post.contactId !== null && { id: post.contactId }),
            ...(post.contactExternalId !== null && {
              externalId: post.contactExternalId,
            }),
          }
        : { type: "member", displayName: post.memberName };

    const id = yield* IntegrationEventId.generate;
    const correlationId = yield* IntegrationEventId.generate;
    const occurredAt = yield* DateTime.now;
    const url = new URL(
      `/${encodeURIComponent(input.organizationId)}/post/${encodeURIComponent(board.slug)}/${encodeURIComponent(input.postSlug)}`,
      appUrl
    ).href;
    const boardUrl = new URL(
      `/${encodeURIComponent(input.organizationId)}/board/${encodeURIComponent(board.slug)}`,
      appUrl
    ).href;
    return yield* recorder
      .recordIntegrationEvent({
        event: {
          causalHopCount: 0,
          correlationId,
          data: {
            actor: input.actor,
            board: { id: board.id, name: board.name, url: boardUrl },
            post: {
              id: input.postId,
              author,
              description: post.content,
              ...(input.metadata !== undefined &&
                Object.keys(input.metadata).length > 0 && {
                  metadata: { ...input.metadata },
                }),
              status,
              title: input.title,
              url,
            },
            ...(input.previousStatusId !== undefined &&
              previousStatus !== undefined && {
                previousStatus,
              }),
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
        Schema.is(PostIntegrationEventRecordingError)(error)
          ? error
          : new PostIntegrationEventRecordingError({
              kind: "infrastructure",
              message: "Post integration event could not be assembled",
            })
      )
    )
);
