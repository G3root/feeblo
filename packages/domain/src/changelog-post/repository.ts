import { currentDb, schema } from "@feeblo/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  TChangelogPostCreate,
  TChangelogPostDelete,
  TChangelogPostList,
} from "./schema";

const makeChangelogPostRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findMany: ({ organizationId }: TChangelogPostList) =>
      db
        .select({
          changelogId: schema.changelogPostTable.changelogId,
          postId: schema.changelogPostTable.postId,
          organizationId: schema.changelogPostTable.organizationId,
          createdAt: schema.changelogPostTable.createdAt,
        })
        .from(schema.changelogPostTable)
        .where(eq(schema.changelogPostTable.organizationId, organizationId)),

    findManyPublished: ({ organizationId }: TChangelogPostList) =>
      db
        .select({
          changelogId: schema.changelogPostTable.changelogId,
          postId: schema.changelogPostTable.postId,
          organizationId: schema.changelogPostTable.organizationId,
          createdAt: schema.changelogPostTable.createdAt,
        })
        .from(schema.changelogPostTable)
        .innerJoin(
          schema.changelogTable,
          eq(schema.changelogPostTable.changelogId, schema.changelogTable.id)
        )
        .innerJoin(
          schema.postTable,
          eq(schema.changelogPostTable.postId, schema.postTable.id)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.postTable.boardId, schema.boardTable.id)
        )
        .where(
          and(
            eq(schema.changelogPostTable.organizationId, organizationId),
            eq(schema.changelogTable.status, "published"),
            eq(schema.boardTable.visibility, "PUBLIC")
          )
        ),

    /**
     * Posts linked to one published changelog entry, with the fields the
     * public detail page renders. Board visibility keeps private posts out of
     * the public response; ordering matches the page's previous
     * link-created-desc order.
     */
    findLinkedPostsPublished: ({
      changelogId,
      organizationId,
    }: {
      readonly changelogId: string;
      readonly organizationId: string;
    }) =>
      db
        .select({
          id: schema.postTable.id,
          slug: schema.postTable.slug,
          status: schema.postStatusTable.type,
          title: schema.postTable.title,
        })
        .from(schema.changelogPostTable)
        .innerJoin(
          schema.postTable,
          eq(schema.changelogPostTable.postId, schema.postTable.id)
        )
        .innerJoin(
          schema.postStatusTable,
          eq(schema.postTable.statusId, schema.postStatusTable.id)
        )
        .innerJoin(
          schema.boardTable,
          eq(schema.postTable.boardId, schema.boardTable.id)
        )
        .where(
          and(
            eq(schema.changelogPostTable.organizationId, organizationId),
            eq(schema.changelogPostTable.changelogId, changelogId),
            eq(schema.boardTable.visibility, "PUBLIC")
          )
        )
        .orderBy(desc(schema.changelogPostTable.createdAt)),

    findEligible: ({ postId, organizationId }: TChangelogPostCreate) =>
      db
        .select({ postId: schema.postTable.id })
        .from(schema.postTable)
        .innerJoin(
          schema.postStatusTable,
          eq(schema.postTable.statusId, schema.postStatusTable.id)
        )
        .leftJoin(
          schema.changelogPostTable,
          eq(schema.postTable.id, schema.changelogPostTable.postId)
        )
        .where(
          and(
            eq(schema.postTable.id, postId),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postStatusTable.type, "COMPLETED"),
            isNull(schema.changelogPostTable.postId)
          )
        )
        .limit(1),

    create: (args: TChangelogPostCreate) =>
      db.insert(schema.changelogPostTable).values(args).pipe(Effect.asVoid),

    delete: ({ changelogId, postId, organizationId }: TChangelogPostDelete) =>
      db
        .delete(schema.changelogPostTable)
        .where(
          and(
            eq(schema.changelogPostTable.changelogId, changelogId),
            eq(schema.changelogPostTable.postId, postId),
            eq(schema.changelogPostTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),
  };
});

export class ChangelogPostRepository extends Context.Service<ChangelogPostRepository>()(
  "ChangelogPostRepository",
  { make: makeChangelogPostRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
