import { currentDb, schema } from "@feeblo/db";
import { and, count, eq, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const makeOgImageRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findPost: ({
      organizationId,
      postSlug,
    }: {
      organizationId: string;
      postSlug: string;
    }) =>
      db
        .select({
          boardName: schema.boardTable.name,
          status: schema.postStatusTable.type,
          title: schema.postTable.title,
          upvoteCount: count(schema.upvoteTable.id),
        })
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .innerJoin(
          schema.postStatusTable,
          eq(schema.postStatusTable.id, schema.postTable.statusId)
        )
        .leftJoin(
          schema.upvoteTable,
          eq(schema.upvoteTable.postId, schema.postTable.id)
        )
        .where(
          and(
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.slug, postSlug),
            // The route is unauthenticated and slugs are slugified titles, so
            // never render metadata for posts on PRIVATE boards — only PUBLIC
            // boards are reachable through the public site anyway.
            eq(schema.boardTable.visibility, "PUBLIC"),
            // Same rule the public post reads apply (`findManyPublic`,
            // `findPublicBySlug`, `isUnlockedPublic`): superseded content stays
            // queryable internally but must not render for the public. Without
            // these two an archived or merged post's title, board, status and
            // upvote count were readable as a PNG by anyone with its slug.
            sql`${schema.postTable.archivedAt} is null`,
            sql`${schema.postTable.mergedIntoPostId} is null`
          )
        )
        .groupBy(
          schema.postTable.id,
          schema.postTable.title,
          schema.boardTable.name,
          schema.postStatusTable.type
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),

    findSite: (siteId: string) =>
      db
        .select({
          name: schema.siteTable.name,
          organizationId: schema.siteTable.organizationId,
        })
        .from(schema.siteTable)
        .where(eq(schema.siteTable.id, siteId))
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),
  };
});

export class OgImageRepository extends Context.Service<OgImageRepository>()(
  "OgImageRepository",
  { make: makeOgImageRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
