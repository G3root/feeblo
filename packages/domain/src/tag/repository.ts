import { Database, schema } from "@feeblo/db";
import { ChangelogTagId, PostTagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";
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

interface TDeletePostTags {
  organizationId: string;
  postId: string;
}

interface TDeleteChangelogTags {
  changelogId: string;
  organizationId: string;
}

interface TInsertRows<Row> {
  rows: Row;
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
  const db = yield* Database.Database;

  return {
    findMany: ({ organizationId }: TFindManyTags) =>
      db.makeQuery((execute, input: TFindManyTags) =>
        execute((client) =>
          client
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
            .where(eq(schema.tagTable.organizationId, input.organizationId))
        )
      )({ organizationId }),

    create: ({
      id,
      name,
      type,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TTagCreate) =>
      db
        .makeQuery((execute, input: TTagCreate) =>
          execute((client) =>
            client.insert(schema.tagTable).values({
              id: input.id,
              name: input.name,
              slug: slugify(input.name),
              type: input.type,
              organizationId: input.organizationId,
              creatorId: input.creatorId,
              ...(input.creatorMemberId
                ? { creatorMemberId: input.creatorMemberId }
                : {}),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          )
        )(
          creatorMemberId
            ? { id, name, type, organizationId, creatorId, creatorMemberId }
            : { id, name, type, organizationId, creatorId }
        )
        .pipe(Effect.asVoid),

    update: ({ id, name, type, organizationId }: TTagUpdate) =>
      db
        .makeQuery((execute, input: TTagUpdate) =>
          execute((client) =>
            client
              .update(schema.tagTable)
              .set({
                name: input.name,
                slug: slugify(input.name),
                type: input.type,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.tagTable.id, input.id),
                  eq(schema.tagTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, name, type, organizationId })
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TTagDelete) =>
      db
        .makeQuery((execute, input: TTagDelete) =>
          execute((client) =>
            client
              .delete(schema.tagTable)
              .where(
                and(
                  eq(schema.tagTable.id, input.id),
                  eq(schema.tagTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.asVoid),

    findPostTags: ({ organizationId }: TPostTagList) =>
      db.makeQuery((execute, input: TPostTagList) =>
        execute((client) =>
          client
            .select({
              id: schema.postTagTable.id,
              postId: schema.postTagTable.postId,
              tagId: schema.postTagTable.tagId,
              organizationId: schema.postTagTable.organizationId,
              createdAt: schema.postTagTable.createdAt,
              updatedAt: schema.postTagTable.updatedAt,
            })
            .from(schema.postTagTable)
            .where(eq(schema.postTagTable.organizationId, input.organizationId))
        )
      )({ organizationId }),

    findChangelogTags: ({ organizationId }: TChangelogTagList) =>
      db.makeQuery((execute, input: TChangelogTagList) =>
        execute((client) =>
          client
            .select({
              id: schema.changelogTagTable.id,
              changelogId: schema.changelogTagTable.changelogId,
              tagId: schema.changelogTagTable.tagId,
              organizationId: schema.changelogTagTable.organizationId,
              createdAt: schema.changelogTagTable.createdAt,
              updatedAt: schema.changelogTagTable.updatedAt,
            })
            .from(schema.changelogTagTable)
            .where(
              eq(schema.changelogTagTable.organizationId, input.organizationId)
            )
        )
      )({ organizationId }),

    setPostTags: ({ postId, organizationId, tagIds }: TPostTagSet) =>
      db
        .transaction(
          Effect.gen(function* () {
            yield* db.makeQuery((execute, input: TDeletePostTags) =>
              execute((client) =>
                client
                  .delete(schema.postTagTable)
                  .where(
                    and(
                      eq(schema.postTagTable.postId, input.postId),
                      eq(
                        schema.postTagTable.organizationId,
                        input.organizationId
                      )
                    )
                  )
              )
            )({ postId, organizationId });

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

            yield* db.makeQuery((execute, input: TInsertRows<typeof rows>) =>
              execute((client) =>
                client
                  .insert(schema.postTagTable)
                  .values(input.rows)
                  .onConflictDoNothing()
              )
            )({ rows });
          })
        )
        .pipe(Effect.asVoid),

    setChangelogTags: ({
      changelogId,
      organizationId,
      tagIds,
    }: TChangelogTagSet) =>
      db
        .transaction(
          Effect.gen(function* () {
            yield* db.makeQuery((execute, input: TDeleteChangelogTags) =>
              execute((client) =>
                client
                  .delete(schema.changelogTagTable)
                  .where(
                    and(
                      eq(
                        schema.changelogTagTable.changelogId,
                        input.changelogId
                      ),
                      eq(
                        schema.changelogTagTable.organizationId,
                        input.organizationId
                      )
                    )
                  )
              )
            )({ changelogId, organizationId });

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

            yield* db.makeQuery((execute, input: TInsertRows<typeof rows>) =>
              execute((client) =>
                client
                  .insert(schema.changelogTagTable)
                  .values(input.rows)
                  .onConflictDoNothing()
              )
            )({ rows });
          })
        )
        .pipe(Effect.asVoid),

    countExistingTags: ({
      organizationId,
      tagIds,
      type,
    }: TCountExistingTags) =>
      tagIds.length === 0
        ? Effect.succeed(0)
        : db
            .makeQuery((execute, input: TCountExistingTags) =>
              execute((client) =>
                client
                  .select({ id: schema.tagTable.id })
                  .from(schema.tagTable)
                  .where(
                    and(
                      eq(schema.tagTable.organizationId, input.organizationId),
                      ...(input.type
                        ? [eq(schema.tagTable.type, input.type)]
                        : []),
                      inArray(schema.tagTable.id, input.tagIds)
                    )
                  )
              )
            )(
              type
                ? { organizationId, tagIds, type }
                : { organizationId, tagIds }
            )
            .pipe(Effect.map((rows) => rows.length)),

    hasPost: ({ postId, organizationId }: THasPost) =>
      db
        .makeQuery((execute, input: THasPost) =>
          execute((client) =>
            client
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, input.postId),
                  eq(schema.postTable.organizationId, input.organizationId)
                )
              )
          )
        )({ postId, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    hasChangelog: ({ changelogId, organizationId }: THasChangelog) =>
      db
        .makeQuery((execute, input: THasChangelog) =>
          execute((client) =>
            client
              .select({ id: schema.changelogTable.id })
              .from(schema.changelogTable)
              .where(
                and(
                  eq(schema.changelogTable.id, input.changelogId),
                  eq(schema.changelogTable.organizationId, input.organizationId)
                )
              )
          )
        )({ changelogId, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    findById: ({ id, organizationId }: TFindTagById) =>
      db
        .makeQuery((execute, input: TFindTagById) =>
          execute((client) =>
            client
              .select({
                id: schema.tagTable.id,
                creatorId: schema.tagTable.creatorId,
              })
              .from(schema.tagTable)
              .where(
                and(
                  eq(schema.tagTable.id, input.id),
                  eq(schema.tagTable.organizationId, input.organizationId)
                )
              )
              .limit(1)
          )
        )({ id, organizationId })
        .pipe(Effect.map(EffectArray.get(0))),
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
