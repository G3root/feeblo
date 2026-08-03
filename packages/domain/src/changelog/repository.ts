import { currentDb, schema } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

interface TChangelogCreateInternal extends TChangelogCreate {
  creatorId: string;
  creatorMemberId?: string;
  excerpt?: string;
}

interface TFindByCreatorId {
  id: string;
  memberId: string;
  organizationId: string;
}

interface TFindMany {
  limit?: number;
  organizationId: string;
}

interface TChangelogUpdateInternal extends TChangelogUpdate {
  excerpt?: string;
}

const PUBLIC_CHANGELOG_LIMIT = 100;

const makeChangelogRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const effectivePublishedAt = sql<Date>`COALESCE(${schema.changelogTable.publishedAt}, ${schema.changelogTable.createdAt})`;
  // TODO handle pagination
  return {
    findByCreatorId: ({ id, organizationId, memberId }: TFindByCreatorId) =>
      db
        .select({ id: schema.changelogTable.id })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId),
            eq(schema.changelogTable.creatorMemberId, memberId)
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),

    findMany: ({ organizationId, limit }: TFindMany) => {
      const query = db
        .select({
          id: schema.changelogTable.id,
          title: schema.changelogTable.title,
          slug: schema.changelogTable.slug,
          content: schema.changelogTable.content,
          excerpt: schema.changelogTable.excerpt,
          status: schema.changelogTable.status,
          scheduledAt: schema.changelogTable.scheduledAt,
          publishedAt: schema.changelogTable.publishedAt,
          organizationId: schema.changelogTable.organizationId,
          creatorMemberId: schema.changelogTable.creatorMemberId,
          creatorId: schema.changelogTable.creatorId,
          createdAt: schema.changelogTable.createdAt,
          updatedAt: schema.changelogTable.updatedAt,
          user: {
            name: sql<string | null>`${schema.userTable.name}`,
            image: sql<string | null>`${schema.userTable.image}`,
          },
        })
        .from(schema.changelogTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.changelogTable.creatorId)
        )
        .where(eq(schema.changelogTable.organizationId, organizationId));

      return limit === undefined ? query : query.limit(limit);
    },

    findManyPublished: ({ organizationId }: TChangelogList) =>
      db
        .select({
          id: schema.changelogTable.id,
          title: schema.changelogTable.title,
          slug: schema.changelogTable.slug,
          content: schema.changelogTable.content,
          excerpt: schema.changelogTable.excerpt,
          status: schema.changelogTable.status,
          scheduledAt: schema.changelogTable.scheduledAt,
          publishedAt: schema.changelogTable.publishedAt,
          organizationId: schema.changelogTable.organizationId,
          creatorMemberId: schema.changelogTable.creatorMemberId,
          creatorId: schema.changelogTable.creatorId,
          createdAt: schema.changelogTable.createdAt,
          updatedAt: schema.changelogTable.updatedAt,
          user: {
            name: sql<string | null>`${schema.userTable.name}`,
            image: sql<string | null>`${schema.userTable.image}`,
          },
        })
        .from(schema.changelogTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.changelogTable.creatorId)
        )
        .where(
          and(
            eq(schema.changelogTable.organizationId, organizationId),
            eq(schema.changelogTable.status, "published")
          )
        )
        .orderBy(desc(effectivePublishedAt))
        .limit(PUBLIC_CHANGELOG_LIMIT),

    create: ({
      id,
      title,
      slug,
      content,
      excerpt,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TChangelogCreateInternal) =>
      db
        .insert(schema.changelogTable)
        .values({
          id,
          title,
          slug: slug || slugify(title),
          content,
          excerpt,
          status,
          scheduledAt,
          publishedAt,
          organizationId,
          creatorId,
          ...(creatorMemberId ? { creatorMemberId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .pipe(Effect.asVoid),

    update: ({
      id,
      title,
      slug,
      content,
      excerpt,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
    }: TChangelogUpdateInternal) =>
      db
        .update(schema.changelogTable)
        .set({
          title,
          slug: slug || slugify(title),
          content,
          excerpt,
          status,
          scheduledAt,
          publishedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TChangelogDelete) =>
      db
        .delete(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),
  };
});

export class ChangelogRepository extends Context.Service<ChangelogRepository>()(
  "ChangelogRepository",
  {
    make: makeChangelogRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
