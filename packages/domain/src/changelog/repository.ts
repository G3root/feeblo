import { currentDb, schema } from "@feeblo/db";
import { ChangelogId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, desc, eq, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TChangelogGet, TChangelogList } from "./schema";

/**
 * The write inputs, typed with plain identifiers rather than the RPC payload
 * schemas' branded ones.
 *
 * The dashboard decodes a branded id before it reaches the repository; the
 * Public API's key is scoped to one workspace and its ids come from the
 * database, so it passes strings. Widening the parameter to `string` keeps one
 * repository serving both without a decode that proves nothing the request did
 * not already establish.
 */
interface TChangelogCreateInternal {
  /** Omitted when a machine key writes; a dashboard caller mints one. */
  id?: string;
  organizationId: string;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "scheduled" | "published";
  scheduledAt: Date | null;
  publishedAt: Date | null;
  coverImage: string | null;
  /** Omitted when the writer is a machine key rather than a member. */
  creatorId?: string;
  creatorMemberId?: string;
  excerpt?: string;
}

interface TChangelogDeleteInternal {
  id: string;
  organizationId: string;
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

interface TChangelogUpdateInternal {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "scheduled" | "published";
  scheduledAt: Date | null;
  publishedAt: Date | null;
  coverImage: string | null;
  excerpt?: string;
}

const PUBLIC_CHANGELOG_LIMIT = 100;

const makeChangelogRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const effectivePublishedAt = sql<Date>`COALESCE(${schema.changelogTable.publishedAt}, ${schema.changelogTable.createdAt})`;
  // Listings are intentionally bounded instead of paginated: findManyPublished
  // returns the newest PUBLIC_CHANGELOG_LIMIT published entries, and clients
  // (dashboard and public-board collections, RSS, widget) render from the full
  // list they receive. Server-side pagination would require an RPC contract
  // change plus collection and UI support.
  return {
    /**
     * Locks the changelog row for a serialized status transition. Callers
     * must run this operation inside an explicit database transaction.
     */
    findStatus: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .select({ status: schema.changelogTable.status })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .for("update")
        .pipe(Effect.map((rows) => rows[0]?.status)),

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

    /**
     * A changelog is scoped to its organization. Policies gate cross-tenant
     * operations on this instead of trusting a caller-supplied changelog id:
     * without it, a manager could link this organization's post to another
     * organization's changelog (ids are enumerable via public listings),
     * creating a cross-tenant link row that surfaces foreign changelog content
     * in this organization's public feed.
     */
    existsInOrganization: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .select({ id: schema.changelogTable.id })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows.length > 0)),

    findMany: ({ organizationId, limit }: TFindMany) => {
      const query = db
        .select({
          id: schema.changelogTable.id,
          title: schema.changelogTable.title,
          slug: schema.changelogTable.slug,
          content: schema.changelogTable.content,
          excerpt: schema.changelogTable.excerpt,
          coverImage: schema.changelogTable.coverImage,
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
          coverImage: schema.changelogTable.coverImage,
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

    /**
     * Published single-entry counterpart of `findManyPublished`, keyed by
     * slug. Resolves to `undefined` when no published entry matches, so
     * detail pages (SEO metadata, feeds) never pull the whole list.
     */
    findPublishedBySlug: ({ organizationId, slug }: TChangelogGet) =>
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
          coverImage: schema.changelogTable.coverImage,
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
            eq(schema.changelogTable.slug, slug),
            eq(schema.changelogTable.status, "published")
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0])),

    /** Creates an entry and returns the stored row. */
    create: ({
      id,
      title,
      slug,
      content,
      excerpt,
      coverImage,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TChangelogCreateInternal) =>
      Effect.gen(function* () {
        const changelogId = id ?? (yield* ChangelogId.generate);
        const now = yield* DateTime.nowAsDate;
        const [created] = yield* db
          .insert(schema.changelogTable)
          .values({
            id: changelogId,
            title,
            slug: slug || slugify(title),
            content,
            excerpt,
            coverImage,
            status,
            scheduledAt,
            publishedAt,
            organizationId,
            ...(creatorId !== undefined && { creatorId }),
            ...(creatorMemberId !== undefined && { creatorMemberId }),
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return created;
      }),

    /** Replaces an entry's writable fields and returns the stored row. */
    update: ({
      id,
      title,
      slug,
      content,
      excerpt,
      coverImage,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
    }: TChangelogUpdateInternal) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [updated] = yield* db
          .update(schema.changelogTable)
          .set({
            title,
            slug: slug || slugify(title),
            content,
            excerpt,
            coverImage,
            status,
            scheduledAt,
            publishedAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.changelogTable.id, id),
              eq(schema.changelogTable.organizationId, organizationId)
            )
          )
          .returning();

        return updated;
      }),

    /** Notification context (title + slug) for one changelog entry. */
    findNotificationContext: ({
      id,
      organizationId,
    }: {
      readonly id: string;
      readonly organizationId: string;
    }) =>
      db
        .select({
          title: schema.changelogTable.title,
          slug: schema.changelogTable.slug,
        })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0])),

    /** Deletes an entry, reporting whether there was one to delete. */
    delete: ({ id, organizationId }: TChangelogDeleteInternal) =>
      db
        .delete(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .returning({ id: schema.changelogTable.id })
        .pipe(Effect.map((rows) => rows.length > 0)),
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
