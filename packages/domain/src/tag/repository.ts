import { DB } from "@feeblo/db";
import {
  changelog as changelogTable,
  changelogTag as changelogTagTable,
  post as postTable,
  postTag as postTagTable,
  tag as tagTable,
} from "@feeblo/db/schema/feedback";
import { generatePublicId } from "@feeblo/utils/id";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  ChangelogTagAssignment,
  PostTagAssignment,
  Tag,
  type TChangelogTagList,
  type TChangelogTagSet,
  type TPostTagList,
  type TPostTagSet,
  type TTag,
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

export class TagRepository extends Effect.Service<TagRepository>()(
  "TagRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ organizationId }: { organizationId: string }) =>
          db
            .select({
              id: tagTable.id,
              name: tagTable.name,
              type: tagTable.type,
              organizationId: tagTable.organizationId,
              createdAt: tagTable.createdAt,
              updatedAt: tagTable.updatedAt,
            })
            .from(tagTable)
            .where(eq(tagTable.organizationId, organizationId))
            .pipe(
              Effect.map((tags) =>
                tags.map((tag) => {
                  return new Tag(tag);
                })
              )
            ),

        create: ({
          id,
          name,
          type,
          organizationId,
          creatorId,
          creatorMemberId,
        }: TTagCreate) =>
          db
            .insert(tagTable)
            .values({
              id,
              name,
              type,
              organizationId,
              creatorId,
              creatorMemberId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .pipe(Effect.asVoid),

        update: ({ id, name, type, organizationId }: TTagUpdate) =>
          db
            .update(tagTable)
            .set({
              name,
              type,
              updatedAt: new Date(),
            })
            .where(
              and(eq(tagTable.id, id), eq(tagTable.organizationId, organizationId))
            )
            .pipe(Effect.asVoid),

        delete: ({ id, organizationId }: TTagDelete) =>
          db
            .delete(tagTable)
            .where(
              and(eq(tagTable.id, id), eq(tagTable.organizationId, organizationId))
            )
            .pipe(Effect.asVoid),

        findPostTags: ({ organizationId }: TPostTagList) =>
          db
            .select({
              id: postTagTable.id,
              postId: postTagTable.postId,
              tagId: postTagTable.tagId,
              organizationId: postTagTable.organizationId,
              createdAt: postTagTable.createdAt,
              updatedAt: postTagTable.updatedAt,
            })
            .from(postTagTable)
            .where(eq(postTagTable.organizationId, organizationId))
            .pipe(
              Effect.map((entries) =>
                entries.map((entry) => new PostTagAssignment(entry))
              )
            ),

        findChangelogTags: ({ organizationId }: TChangelogTagList) =>
          db
            .select({
              id: changelogTagTable.id,
              changelogId: changelogTagTable.changelogId,
              tagId: changelogTagTable.tagId,
              organizationId: changelogTagTable.organizationId,
              createdAt: changelogTagTable.createdAt,
              updatedAt: changelogTagTable.updatedAt,
            })
            .from(changelogTagTable)
            .where(eq(changelogTagTable.organizationId, organizationId))
            .pipe(
              Effect.map((entries) =>
                entries.map((entry) => new ChangelogTagAssignment(entry))
              )
            ),

        setPostTags: ({ postId, organizationId, tagIds }: TPostTagSet) =>
          Effect.gen(function* () {
            yield* db
              .delete(postTagTable)
              .where(
                and(
                  eq(postTagTable.postId, postId),
                  eq(postTagTable.organizationId, organizationId)
                )
              );

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

            yield* db.insert(postTagTable).values(rows);
          }).pipe(Effect.asVoid),

        setChangelogTags: ({
          changelogId,
          organizationId,
          tagIds,
        }: TChangelogTagSet) =>
          Effect.gen(function* () {
            yield* db
              .delete(changelogTagTable)
              .where(
                and(
                  eq(changelogTagTable.changelogId, changelogId),
                  eq(changelogTagTable.organizationId, organizationId)
                )
              );

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

            yield* db.insert(changelogTagTable).values(rows);
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
                .select({ id: tagTable.id })
                .from(tagTable)
                .where(
                  and(
                    eq(tagTable.organizationId, organizationId),
                    ...(type ? [eq(tagTable.type, type)] : []),
                    inArray(tagTable.id, tagIds)
                  )
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
            .select({ id: postTable.id })
            .from(postTable)
            .where(
              and(
                eq(postTable.id, postId),
                eq(postTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.map((rows) => rows.length > 0)),

        hasChangelog: ({
          changelogId,
          organizationId,
        }: {
          changelogId: string;
          organizationId: string;
        }) =>
          db
            .select({ id: changelogTable.id })
            .from(changelogTable)
            .where(
              and(
                eq(changelogTable.id, changelogId),
                eq(changelogTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.map((rows) => rows.length > 0)),
      };
    }),
  }
) {}
