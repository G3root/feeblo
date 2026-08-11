import { currentDb, schema } from "@feeblo/db";
import type { TPostActivityKind } from "@feeblo/db/validation-schema/activity-kind";
import type { LegidOf } from "@feeblo/id";
import { PostActivityId } from "@feeblo/id";
import { and, asc, eq, gte } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface CreatePostActivity {
  actorId: string | null;
  actorMemberId: string | null;
  commentId?: string | null;
  id?: LegidOf<"PostActivityId">;
  kind: TPostActivityKind;
  nextValue?: string | null;
  organizationId: string;
  postId: string;
  previousValue?: string | null;
}

const makePostActivityRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const makeRow = (input: CreatePostActivity) =>
    Effect.gen(function* () {
      const id = input.id ?? (yield* PostActivityId.generate);
      return {
        id,
        organizationId: input.organizationId,
        postId: input.postId,
        actorId: input.actorId,
        actorMemberId: input.actorMemberId,
        kind: input.kind,
        previousValue: input.previousValue ?? null,
        nextValue: input.nextValue ?? null,
        commentId: input.commentId ?? null,
      };
    });

  return {
    create: (input: CreatePostActivity) =>
      makeRow(input).pipe(
        Effect.flatMap((row) =>
          db.insert(schema.postActivityTable).values(row).pipe(Effect.asVoid)
        )
      ),
    createMany: (inputs: readonly CreatePostActivity[]) =>
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
