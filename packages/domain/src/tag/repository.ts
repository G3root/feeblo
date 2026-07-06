import { currentDb, schema, transaction } from "@feeblo/db";
import { ChangelogTagId, PostTagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as EffectArray from "effect/Array";
import * as Layer from "effect/Layer";

import type {
  TChangelogTagList,
  TChangelogTagSet,
  TPostTagList,
  TPostTagSet,
  TTag,
} from "./schema";

interface TTagCreate {
  creatorId: string;
  creatorMemberId?: string;
  id: string;
  name: string;
  organizationId: string;
  type: TTag["type"];
}

interface TTagUpdate {
  id: string;
  name: string;
  organizationId: string;
  type: TTag["type"];
}

interface TTagDelete {
  id: string;
  organizationId: string;
}

interface TFindManyTags {
  organizationId: string;
}

interface TCountExistingTags {
  organizationId: string;
  tagIds: readonly string[];
  type?: TTag["type"];
}

interface THasPost {
  organizationId: string;
  postId: string;
}

interface THasChangelog {
  changelogId: string;
  organizationId: string;
}

interface TFindTagById {
  id: string;
  organizationId: string;
}

const makeTagRepository = Effect.gen(function* () {
  return {
    findMany: ({ organizationId }: TFindManyTags) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.tagTable.id,
            name: schema.tagTable.name,
            slug: schema.tagTable.slug,
            type: schema.tagTable.type,
            organizationId: schema.tagTable.organizationId,
            createdAt: schema.tagTable.createdAt,
            updatedAt: schema.tagTable.updatedAt,
          })
          .from(schema.tagTable)
          .where(eq(schema.tagTable.organizationId, organizationId));
      }),

    create: ({
      id,
      name,
      type,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TTagCreate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db.insert(schema.tagTable).values({
          id,
          name,
          slug: slugify(name),
          type,
          organizationId,
          creatorId,
          ...(creatorMemberId ? { creatorMemberId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }).pipe(Effect.asVoid),

    update: ({ id, name, type, organizationId }: TTagUpdate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.tagTable)
          .set({
            name,
            slug: slugify(name),
            type,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tagTable.id, id),
              eq(schema.tagTable.organizationId, organizationId)
            )
          );
      }).pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TTagDelete) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .delete(schema.tagTable)
          .where(
            and(
              eq(schema.tagTable.id, id),
              eq(schema.tagTable.organizationId, organizationId)
            )
          );
      }).pipe(Effect.asVoid),

    findPostTags: ({ organizationId }: TPostTagList) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.postTagTable.id,
            postId: schema.postTagTable.postId,
            tagId: schema.postTagTable.tagId,
            organizationId: schema.postTagTable.organizationId,
            createdAt: schema.postTagTable.createdAt,
            updatedAt: schema.postTagTable.updatedAt,
          })
          .from(schema.postTagTable)
          .where(eq(schema.postTagTable.organizationId, organizationId));
      }),

    findChangelogTags: ({ organizationId }: TChangelogTagList) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.changelogTagTable.id,
            changelogId: schema.changelogTagTable.changelogId,
            tagId: schema.changelogTagTable.tagId,
            organizationId: schema.changelogTagTable.organizationId,
            createdAt: schema.changelogTagTable.createdAt,
            updatedAt: schema.changelogTagTable.updatedAt,
          })
          .from(schema.changelogTagTable)
          .where(eq(schema.changelogTagTable.organizationId, organizationId));
      }),

    setPostTags: ({ postId, organizationId, tagIds }: TPostTagSet) =>
      transaction(
        Effect.gen(function* () {
          const db = yield* currentDb;
          yield* db
            .delete(schema.postTagTable)
            .where(
              and(
                eq(schema.postTagTable.postId, postId),
                eq(schema.postTagTable.organizationId, organizationId)
              )
            );

          if (tagIds.length === 0) {
            return;
          }

          const rows = yield* Effect.forEach(tagIds, (tagId) =>
            PostTagId.generate.pipe(
              Effect.map((id) => ({
                id,
                postId,
                tagId,
                organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
              }))
            )
          );

          yield* db
            .insert(schema.postTagTable)
            .values(rows)
            .onConflictDoNothing();
        })
      ).pipe(Effect.asVoid),

    setChangelogTags: ({
      changelogId,
      organizationId,
      tagIds,
    }: TChangelogTagSet) =>
      transaction(
        Effect.gen(function* () {
          const db = yield* currentDb;
          yield* db
            .delete(schema.changelogTagTable)
            .where(
              and(
                eq(schema.changelogTagTable.changelogId, changelogId),
                eq(schema.changelogTagTable.organizationId, organizationId)
              )
            );

          if (tagIds.length === 0) {
            return;
          }

          const rows = yield* Effect.forEach(tagIds, (tagId) =>
            ChangelogTagId.generate.pipe(
              Effect.map((id) => ({
                id,
                changelogId,
                tagId,
                organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
              }))
            )
          );

          yield* db
            .insert(schema.changelogTagTable)
            .values(rows)
            .onConflictDoNothing();
        })
      ).pipe(Effect.asVoid),

    countExistingTags: ({
      organizationId,
      tagIds,
      type,
    }: TCountExistingTags) =>
      tagIds.length === 0
        ? Effect.succeed(0)
        : Effect.gen(function* () {
            const db = yield* currentDb;
            const rows = yield* db
              .select({ id: schema.tagTable.id })
              .from(schema.tagTable)
              .where(
                and(
                  eq(schema.tagTable.organizationId, organizationId),
                  ...(type ? [eq(schema.tagTable.type, type)] : []),
                  inArray(schema.tagTable.id, tagIds)
                )
              );
            return rows.length;
          }),

    hasPost: ({ postId, organizationId }: THasPost) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          );
        return rows.length > 0;
      }),

    hasChangelog: ({ changelogId, organizationId }: THasChangelog) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const rows = yield* db
          .select({ id: schema.changelogTable.id })
          .from(schema.changelogTable)
          .where(
            and(
              eq(schema.changelogTable.id, changelogId),
              eq(schema.changelogTable.organizationId, organizationId)
            )
          );
        return rows.length > 0;
      }),

    findById: ({ id, organizationId }: TFindTagById) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.tagTable.id,
            creatorId: schema.tagTable.creatorId,
          })
          .from(schema.tagTable)
          .where(
            and(
              eq(schema.tagTable.id, id),
              eq(schema.tagTable.organizationId, organizationId)
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));
      }),
  };
});

export class TagRepository extends Context.Service<TagRepository>()(
  "TagRepository",
  {
    make: makeTagRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
