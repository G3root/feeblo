import { Database, schema } from "@feeblo/db";
import { generatePublicId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type {
  TChangelogTagList,
  TChangelogTagSet,
  TPostTagList,
  TPostTagSet,
  TTag,
} from "./schema";

type TTagCreate = {
  id: string;
  name: string;
  type: TTag["type"];
  organizationId: string;
  creatorId: string;
  creatorMemberId?: string;
};

type TTagUpdate = {
  id: string;
  name: string;
  type: TTag["type"];
  organizationId: string;
};

type TTagDelete = {
  id: string;
  organizationId: string;
};

const makeTagRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findMany: ({ organizationId }: { organizationId: string }) =>
      db.makeQuery((execute, input: { organizationId: string }) =>
        execute((client) =>
          client
            .select({
              id: schema.tag.id,
              name: schema.tag.name,
              slug: schema.tag.slug,
              type: schema.tag.type,
              organizationId: schema.tag.organizationId,
              createdAt: schema.tag.createdAt,
              updatedAt: schema.tag.updatedAt,
            })
            .from(schema.tag)
            .where(eq(schema.tag.organizationId, input.organizationId))
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
            client.insert(schema.tag).values({
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
              .update(schema.tag)
              .set({
                name: input.name,
                slug: slugify(input.name),
                type: input.type,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.tag.id, input.id),
                  eq(schema.tag.organizationId, input.organizationId)
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
              .delete(schema.tag)
              .where(
                and(
                  eq(schema.tag.id, input.id),
                  eq(schema.tag.organizationId, input.organizationId)
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
              id: schema.postTag.id,
              postId: schema.postTag.postId,
              tagId: schema.postTag.tagId,
              organizationId: schema.postTag.organizationId,
              createdAt: schema.postTag.createdAt,
              updatedAt: schema.postTag.updatedAt,
            })
            .from(schema.postTag)
            .where(eq(schema.postTag.organizationId, input.organizationId))
        )
      )({ organizationId }),

    findChangelogTags: ({ organizationId }: TChangelogTagList) =>
      db.makeQuery((execute, input: TChangelogTagList) =>
        execute((client) =>
          client
            .select({
              id: schema.changelogTag.id,
              changelogId: schema.changelogTag.changelogId,
              tagId: schema.changelogTag.tagId,
              organizationId: schema.changelogTag.organizationId,
              createdAt: schema.changelogTag.createdAt,
              updatedAt: schema.changelogTag.updatedAt,
            })
            .from(schema.changelogTag)
            .where(eq(schema.changelogTag.organizationId, input.organizationId))
        )
      )({ organizationId }),

    setPostTags: ({ postId, organizationId, tagIds }: TPostTagSet) =>
      Effect.gen(function* () {
        yield* db.makeQuery(
          (execute, input: { postId: string; organizationId: string }) =>
            execute((client) =>
              client
                .delete(schema.postTag)
                .where(
                  and(
                    eq(schema.postTag.postId, input.postId),
                    eq(schema.postTag.organizationId, input.organizationId)
                  )
                )
            )
        )({ postId, organizationId });

        if (tagIds.length === 0) {
          return;
        }

        const rows = yield* Effect.forEach(tagIds, (tagId) =>
          Effect.promise(() => generatePublicId()).pipe(
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

        yield* db.makeQuery((execute, input: { rows: typeof rows }) =>
          execute((client) => client.insert(schema.postTag).values(input.rows))
        )({ rows });
      }).pipe(Effect.asVoid),

    setChangelogTags: ({
      changelogId,
      organizationId,
      tagIds,
    }: TChangelogTagSet) =>
      Effect.gen(function* () {
        yield* db.makeQuery(
          (execute, input: { changelogId: string; organizationId: string }) =>
            execute((client) =>
              client
                .delete(schema.changelogTag)
                .where(
                  and(
                    eq(schema.changelogTag.changelogId, input.changelogId),
                    eq(schema.changelogTag.organizationId, input.organizationId)
                  )
                )
            )
        )({ changelogId, organizationId });

        if (tagIds.length === 0) {
          return;
        }

        const rows = yield* Effect.forEach(tagIds, (tagId) =>
          Effect.promise(() => generatePublicId()).pipe(
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

        yield* db.makeQuery((execute, input: { rows: typeof rows }) =>
          execute((client) =>
            client.insert(schema.changelogTag).values(input.rows)
          )
        )({ rows });
      }).pipe(Effect.asVoid),

    countExistingTags: ({
      organizationId,
      tagIds,
      type,
    }: {
      organizationId: string;
      tagIds: readonly string[];
      type?: TTag["type"];
    }) =>
      tagIds.length === 0
        ? Effect.succeed(0)
        : db
            .makeQuery(
              (
                execute,
                input: {
                  organizationId: string;
                  tagIds: readonly string[];
                  type?: TTag["type"];
                }
              ) =>
                execute((client) =>
                  client
                    .select({ id: schema.tag.id })
                    .from(schema.tag)
                    .where(
                      and(
                        eq(schema.tag.organizationId, input.organizationId),
                        ...(input.type
                          ? [eq(schema.tag.type, input.type)]
                          : []),
                        inArray(schema.tag.id, input.tagIds)
                      )
                    )
                )
            )(
              type
                ? { organizationId, tagIds, type }
                : { organizationId, tagIds }
            )
            .pipe(Effect.map((rows) => rows.length)),

    hasPost: ({
      postId,
      organizationId,
    }: {
      postId: string;
      organizationId: string;
    }) =>
      db
        .makeQuery(
          (execute, input: { postId: string; organizationId: string }) =>
            execute((client) =>
              client
                .select({ id: schema.post.id })
                .from(schema.post)
                .where(
                  and(
                    eq(schema.post.id, input.postId),
                    eq(schema.post.organizationId, input.organizationId)
                  )
                )
            )
        )({ postId, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    hasChangelog: ({
      changelogId,
      organizationId,
    }: {
      changelogId: string;
      organizationId: string;
    }) =>
      db
        .makeQuery(
          (execute, input: { changelogId: string; organizationId: string }) =>
            execute((client) =>
              client
                .select({ id: schema.changelog.id })
                .from(schema.changelog)
                .where(
                  and(
                    eq(schema.changelog.id, input.changelogId),
                    eq(schema.changelog.organizationId, input.organizationId)
                  )
                )
            )
        )({ changelogId, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),
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
