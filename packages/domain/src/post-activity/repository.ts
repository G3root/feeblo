import { currentDb, schema } from "@feeblo/db";
import type { LegidOf } from "@feeblo/id";
import { PostActivityId } from "@feeblo/id";
import { and, asc, eq, gte } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Structured provenance stored beside an activity. On-behalf actions record
 * the customer subject distinct from the staff actor, e.g.
 * `{ onBehalfOf: { contactId, userId? } }`. A field is omitted when the
 * action cannot know it — e.g. removing a voter by userId may have no
 * contact for them.
 */
export interface PostActivityMetadata {
  readonly onBehalfOf: {
    readonly contactId?: string | undefined;
    readonly userId?: string | undefined;
  };
}

/** Actor facts shared by every recorded activity. */
export interface PostActivityActor {
  readonly actorId: string | null;
  readonly actorMemberId: string | null;
  /** Explicit row id override; only official-update publishing sets one. */
  readonly id?: LegidOf<"PostActivityId">;
  readonly organizationId: string;
  readonly postId: string;
  /** Optional structured provenance (see `PostActivityMetadata`). */
  readonly metadata?: PostActivityMetadata;
}

/**
 * Type-safe activity construction contract: each kind carries exactly the
 * fields it records, so illegal payloads (e.g. a `TAG_ADDED` without a tag)
 * are unrepresentable. The repository is the only place that maps these to
 * the generic `previousValue` / `nextValue` / `commentId` columns.
 */
export type PostActivityInput = PostActivityActor &
  (
    | { readonly kind: "POST_CREATED" }
    | {
        readonly kind: "TITLE_CHANGED";
        readonly previousTitle: string;
        readonly nextTitle: string;
      }
    | { readonly kind: "CONTENT_CHANGED" }
    | {
        readonly kind: "STATUS_CHANGED";
        readonly previousStatusId: string;
        readonly nextStatusId: string;
      }
    | {
        readonly kind: "BOARD_CHANGED";
        readonly previousBoardId: string;
        readonly nextBoardId: string;
      }
    | {
        readonly kind: "ETA_CHANGED";
        readonly previousEta: string | null;
        readonly nextEta: string | null;
      }
    | { readonly kind: "POST_LOCKED" }
    | { readonly kind: "POST_UNLOCKED" }
    | { readonly kind: "POST_ARCHIVED" }
    | { readonly kind: "POST_UNARCHIVED" }
    | { readonly kind: "TAG_ADDED"; readonly tagId: string }
    | { readonly kind: "TAG_REMOVED"; readonly tagId: string }
    | { readonly kind: "OFFICIAL_UPDATE_PUBLISHED"; readonly body: string }
    | {
        readonly kind: "COMMENT_CREATED";
        readonly commentId: string;
        readonly visibility: string | null;
      }
    | {
        readonly kind: "COMMENT_UPDATED";
        readonly commentId: string;
        readonly visibility: string | null;
      }
    | { readonly kind: "COMMENT_DELETED"; readonly commentId: string }
    | { readonly kind: "VOTE_ADDED" }
    | { readonly kind: "VOTE_REMOVED" }
  );

type PostActivityRow = {
  kind: PostActivityInput["kind"];
  previousValue: string | null;
  nextValue: string | null;
  commentId: string | null;
};

/**
 * Maps a typed activity input to the generic column vocabulary. Kept private:
 * callers construct domain-shaped inputs and never see `previousValue` /
 * `nextValue` / `commentId`. Exhaustive over `PostActivityInput`, so adding a
 * new kind without a mapping here is a compile error.
 */
const toRow = (input: PostActivityInput): PostActivityRow => {
  switch (input.kind) {
    case "POST_CREATED":
    case "CONTENT_CHANGED":
    case "POST_LOCKED":
    case "POST_UNLOCKED":
    case "POST_ARCHIVED":
    case "POST_UNARCHIVED":
    case "VOTE_ADDED":
    case "VOTE_REMOVED":
      return {
        kind: input.kind,
        previousValue: null,
        nextValue: null,
        commentId: null,
      };
    case "TITLE_CHANGED":
      return {
        kind: input.kind,
        previousValue: input.previousTitle,
        nextValue: input.nextTitle,
        commentId: null,
      };
    case "STATUS_CHANGED":
      return {
        kind: input.kind,
        previousValue: input.previousStatusId,
        nextValue: input.nextStatusId,
        commentId: null,
      };
    case "BOARD_CHANGED":
      return {
        kind: input.kind,
        previousValue: input.previousBoardId,
        nextValue: input.nextBoardId,
        commentId: null,
      };
    case "ETA_CHANGED":
      return {
        kind: input.kind,
        previousValue: input.previousEta,
        nextValue: input.nextEta,
        commentId: null,
      };
    case "TAG_ADDED":
    case "TAG_REMOVED":
      return {
        kind: input.kind,
        previousValue: null,
        nextValue: input.tagId,
        commentId: null,
      };
    case "OFFICIAL_UPDATE_PUBLISHED":
      return {
        kind: input.kind,
        previousValue: null,
        nextValue: input.body,
        commentId: null,
      };
    case "COMMENT_CREATED":
    case "COMMENT_UPDATED":
      return {
        kind: input.kind,
        previousValue: null,
        nextValue: input.visibility,
        commentId: input.commentId,
      };
    case "COMMENT_DELETED":
      return {
        kind: input.kind,
        previousValue: null,
        nextValue: null,
        commentId: input.commentId,
      };
    default: {
      // Every kind is handled above; the default arm only fires when a new
      // kind is added to PostActivityInput without a mapping here, or when
      // invalid runtime input reaches the switch. Fail loudly instead of
      // letting that input be written to the database.
      const unhandled: never = input;
      // SAFETY: `unhandled` is statically `never`; this cast only preserves the
      // discriminant for the defensive runtime error below.
      throw new Error(
        `Unhandled post activity kind: ${String((unhandled as PostActivityInput).kind)}`
      );
    }
  }
};

const makePostActivityRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const makeRow = (input: PostActivityInput) =>
    Effect.gen(function* () {
      const id = input.id ?? (yield* PostActivityId.generate);
      return {
        id,
        organizationId: input.organizationId,
        postId: input.postId,
        actorId: input.actorId,
        actorMemberId: input.actorMemberId,
        metadata: input.metadata ?? null,
        ...toRow(input),
      };
    });

  return {
    create: (input: PostActivityInput) =>
      makeRow(input).pipe(
        Effect.flatMap((row) =>
          db.insert(schema.postActivityTable).values(row).pipe(Effect.asVoid)
        )
      ),
    createMany: (inputs: readonly PostActivityInput[]) =>
      Effect.forEach(inputs, makeRow).pipe(
        Effect.flatMap((rows) =>
          rows.length === 0
            ? Effect.void
            : db
                .insert(schema.postActivityTable)
                .values(rows)
                .pipe(Effect.asVoid)
        )
      ),
    findMany: ({
      organizationId,
      postId,
      since,
    }: {
      organizationId: string;
      postId: string;
      since?: Date;
    }) =>
      db
        .select({
          id: schema.postActivityTable.id,
          organizationId: schema.postActivityTable.organizationId,
          postId: schema.postActivityTable.postId,
          actorId: schema.postActivityTable.actorId,
          actorMemberId: schema.postActivityTable.actorMemberId,
          actorName: schema.userTable.name,
          actorImage: schema.userTable.image,
          kind: schema.postActivityTable.kind,
          previousValue: schema.postActivityTable.previousValue,
          nextValue: schema.postActivityTable.nextValue,
          commentId: schema.postActivityTable.commentId,
          createdAt: schema.postActivityTable.createdAt,
        })
        .from(schema.postActivityTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postActivityTable.actorId)
        )
        .where(
          and(
            eq(schema.postActivityTable.organizationId, organizationId),
            eq(schema.postActivityTable.postId, postId),
            ...(since ? [gte(schema.postActivityTable.createdAt, since)] : [])
          )
        )
        .orderBy(
          asc(schema.postActivityTable.createdAt),
          asc(schema.postActivityTable.id)
        )
        .pipe(
          Effect.map((rows) =>
            rows.map(({ actorName, actorImage, ...activity }) => ({
              ...activity,
              actor: {
                name: actorName,
                image: actorImage,
              },
            }))
          )
        ),
  };
});

export class PostActivityRepository extends Context.Service<PostActivityRepository>()(
  "PostActivityRepository",
  {
    make: makePostActivityRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
