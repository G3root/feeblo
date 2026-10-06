import { currentDb, Database, schema } from "@feeblo/db";
import type { TChangelogCategoryIconType } from "@feeblo/domain-contracts/changelog-category-icon-type";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  cleanupOrphanedEditorAssets,
  syncChangelogAssetReferences,
} from "../../asset/service";
import type { Cursor } from "../../public-api/cursor";
import {
  conflictError,
  forbiddenScopeError,
  notFoundError,
} from "../../public-api/errors";
import { InternalServerError, withRemapDbErrors } from "../../rpc-errors";
import { S3UploadService } from "../../services/s3";
import { makeChangelogPublication } from "../publication";
import { ChangelogRepository } from "../repository";
import type { TPublicApiChangelogStatus } from "./schema";

/**
 * What a changelog mapper is allowed to read.
 *
 * Narrow for the same reason as the post and tag sources: `changelog` also
 * carries `creatorId` and `creatorMemberId`, and a column that is not named
 * here has no way into a public response. The status vocabulary is the closed
 * literal union from `./schema`, not the dashboard's schema module.
 */
export type PublicApiChangelogCategoryEntry = {
  readonly id: string;
  readonly name: string;
  readonly iconType: TChangelogCategoryIconType;
  readonly icon: string;
};

export type PublicApiChangelogLinkedPostEntry = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
};

export type PublicApiChangelogSource = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly coverImage: string | null;
  readonly status: TPublicApiChangelogStatus;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly categories: readonly PublicApiChangelogCategoryEntry[];
  readonly linkedPosts: readonly PublicApiChangelogLinkedPostEntry[];
};

export type PublicApiChangelogDetail = PublicApiChangelogSource & {
  readonly content: string;
};

export type PublicApiChangelogPage = {
  readonly entries: readonly PublicApiChangelogSource[];
  readonly nextCursor: Cursor | null;
};

/**
 * The changelog column list, and the only place an entry field is selected
 * from. `creatorId` and `creatorMemberId` are deliberately absent: a machine
 * key is not a member, and the dashboard's actor columns have no business in a
 * public payload even when they are populated.
 */
const CHANGELOG_COLUMNS = {
  id: schema.changelogTable.id,
  title: schema.changelogTable.title,
  slug: schema.changelogTable.slug,
  excerpt: schema.changelogTable.excerpt,
  coverImage: schema.changelogTable.coverImage,
  status: schema.changelogTable.status,
  scheduledAt: schema.changelogTable.scheduledAt,
  publishedAt: schema.changelogTable.publishedAt,
  createdAt: schema.changelogTable.createdAt,
  updatedAt: schema.changelogTable.updatedAt,
} as const;

/** The detail columns: what the list selects plus the stored body. */
const CHANGELOG_DETAIL_COLUMNS = {
  ...CHANGELOG_COLUMNS,
  content: schema.changelogTable.content,
} as const;

type ChangelogRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage: string | null;
  status: TPublicApiChangelogStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const toChangelogSource = (
  row: ChangelogRow,
  collections: {
    readonly categories: readonly PublicApiChangelogCategoryEntry[];
    readonly linkedPosts: readonly PublicApiChangelogLinkedPostEntry[];
  }
): PublicApiChangelogSource => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  coverImage: row.coverImage,
  status: row.status,
  scheduledAt: row.scheduledAt,
  publishedAt: row.publishedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  categories: collections.categories,
  linkedPosts: collections.linkedPosts,
});

const toChangelogDetail = (
  row: ChangelogRow & { content: string },
  collections: {
    readonly categories: readonly PublicApiChangelogCategoryEntry[];
    readonly linkedPosts: readonly PublicApiChangelogLinkedPostEntry[];
  }
): PublicApiChangelogDetail => ({
  ...toChangelogSource(row, collections),
  content: row.content,
});

/**
 * Changelog storage as the Public API alone reads it.
 *
 * The row writes are `ChangelogRepository`'s own — the same insert, update, and
 * delete the dashboard's editor calls — and the publication side effects are
 * `makeChangelogPublication`'s, so publishing from a machine key reaches
 * subscribers exactly as publishing from the editor does. What this service
 * adds is the public-specific parts: cursor-shaped paging, the published error
 * vocabulary, and the asset bookkeeping that keeps an entry's editor-asset
 * references in step with its content.
 */
const makePublicApiChangelogRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const changelogs = yield* ChangelogRepository;
  const s3 = yield* S3UploadService;
  const publication = yield* makeChangelogPublication;

  /**
   * The labels and linked posts of a page of entries, in one query each.
   *
   * Batched by the page's ids rather than fetched per entry, so a page of
   * twenty entries is three queries rather than forty-one. Both collections
   * are ordered by their link's creation time and then by the link's own
   * identifier — the category link's id, the post link's post id — so two
   * labels or posts attached at the same instant still read in one stable
   * order rather than whatever the planner returns.
   */
  const collectionsByChangelogId = (
    changelogIds: readonly string[],
    organizationId: string
  ) =>
    Effect.gen(function* () {
      const empty = {
        categories: new Map<string, PublicApiChangelogCategoryEntry[]>(),
        linkedPosts: new Map<string, PublicApiChangelogLinkedPostEntry[]>(),
      };
      if (changelogIds.length === 0) {
        return empty;
      }

      const categoryRows = yield* db
        .select({
          changelogId: schema.changelogCategoryLinkTable.changelogId,
          id: schema.changelogCategoryTable.id,
          name: schema.changelogCategoryTable.name,
          iconType: schema.changelogCategoryTable.iconType,
          icon: schema.changelogCategoryTable.icon,
        })
        .from(schema.changelogCategoryLinkTable)
        .innerJoin(
          schema.changelogCategoryTable,
          eq(
            schema.changelogCategoryTable.id,
            schema.changelogCategoryLinkTable.categoryId
          )
        )
        .where(
          and(
            eq(
              schema.changelogCategoryLinkTable.organizationId,
              organizationId
            ),
            inArray(schema.changelogCategoryLinkTable.changelogId, changelogIds)
          )
        )
        .orderBy(
          asc(schema.changelogCategoryLinkTable.createdAt),
          asc(schema.changelogCategoryLinkTable.id)
        );

      const postRows = yield* db
        .select({
          changelogId: schema.changelogPostTable.changelogId,
          id: schema.postTable.id,
          title: schema.postTable.title,
          slug: schema.postTable.slug,
        })
        .from(schema.changelogPostTable)
        .innerJoin(
          schema.postTable,
          eq(schema.postTable.id, schema.changelogPostTable.postId)
        )
        .where(
          and(
            eq(schema.changelogPostTable.organizationId, organizationId),
            inArray(schema.changelogPostTable.changelogId, changelogIds)
          )
        )
        .orderBy(
          asc(schema.changelogPostTable.createdAt),
          // The table's key is `(changelogId, postId)`, so the post id is the
          // unique tiebreaker a link created in the same instant needs.
          asc(schema.changelogPostTable.postId)
        );

      const categories = new Map<string, PublicApiChangelogCategoryEntry[]>();
      for (const row of categoryRows) {
        const entries = categories.get(row.changelogId) ?? [];
        entries.push({
          icon: row.icon,
          iconType: row.iconType,
          id: row.id,
          name: row.name,
        });
        categories.set(row.changelogId, entries);
      }

      const linkedPosts = new Map<
        string,
        PublicApiChangelogLinkedPostEntry[]
      >();
      for (const row of postRows) {
        const entries = linkedPosts.get(row.changelogId) ?? [];
        entries.push({ id: row.id, slug: row.slug, title: row.title });
        linkedPosts.set(row.changelogId, entries);
      }

      return { categories, linkedPosts };
    });

  /**
   * Keeps an entry's editor-asset references in step with its content.
   *
   * The asset service reads the database from the fiber context, which would
   * put a raw `Database` requirement on every handler that calls a write — and
   * `HttpApiBuilder` threads a handler effect's requirements into the route
   * layer, where the composition root cannot satisfy a request it has already
   * fulfilled. Providing the handle this repository already holds removes it.
   * The open transaction is fiber-local, not a service, so the write still
   * lands in the transaction that is running when this is called.
   */
  const syncAssets = (args: {
    readonly assetIds: readonly string[];
    readonly changelogId: string;
    readonly content: string;
    readonly coverImageUrl: string | null;
    readonly organizationId: string;
  }) =>
    syncChangelogAssetReferences(args).pipe(
      Effect.provideService(Database.Database, db)
    );

  /**
   * The dashboard's best-effort orphan sweep, after a delete commits.
   *
   * The asset service reads the database and media storage from the fiber
   * context, which would put both on the calling handler and therefore on the
   * route layer; providing the handles this repository already holds keeps the
   * route's requirements at the repository itself. The database service is the
   * same one the delete used, and the transaction connection is fiber-local,
   * so nothing about the sweep changes. A sweep that fails is logged, never
   * raised: the entry is already gone, and a leaked asset row is not the
   * caller's problem to retry.
   */
  const cleanupOrphanedAssets = (organizationId: string) =>
    cleanupOrphanedEditorAssets({ organizationId }).pipe(
      Effect.provideService(Database.Database, db),
      Effect.provideService(S3UploadService, s3),
      Effect.catch((cause) =>
        Effect.logWarning(
          "Failed to clean up orphaned editor assets",
          cause
        ).pipe(Effect.annotateLogs({ organizationId }))
      )
    );

  return {
    /**
     * One page of the workspace's changelog, newest first.
     *
     * Ordered and paged exactly like a board's posts and the tag list — the
     * same `(createdAt, id)` tuple and the same cursor — so a caller learns
     * one paging rule for the whole API. Drafts are included: the key is the
     * workspace's own credential, and an integration that syncs release notes
     * has to see what has not shipped yet. `status` narrows the page when the
     * caller asks for one.
     */
    list: ({
      cursor,
      limit,
      organizationId,
      status,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
      status: TPublicApiChangelogStatus | null;
    }) =>
      Effect.gen(function* () {
        const conditions: SQL[] = [
          eq(schema.changelogTable.organizationId, organizationId),
        ];
        if (status !== null) {
          conditions.push(eq(schema.changelogTable.status, status));
        }
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.changelogTable.createdAt}, ${schema.changelogTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(CHANGELOG_COLUMNS)
          .from(schema.changelogTable)
          .where(and(...conditions))
          .orderBy(
            desc(schema.changelogTable.createdAt),
            desc(schema.changelogTable.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        const collections = yield* collectionsByChangelogId(
          pageRows.map((row) => row.id),
          organizationId
        );

        return {
          entries: pageRows.map((row) =>
            toChangelogSource(row, {
              categories: collections.categories.get(row.id) ?? [],
              linkedPosts: collections.linkedPosts.get(row.id) ?? [],
            })
          ),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiChangelogPage;
      }).pipe(withRemapDbErrors("PublicApiChangelog", "select")),

    /** One entry of the calling workspace, body included, or nothing. */
    find: ({
      changelogId,
      organizationId,
    }: {
      changelogId: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(CHANGELOG_DETAIL_COLUMNS)
          .from(schema.changelogTable)
          .where(
            and(
              eq(schema.changelogTable.id, changelogId),
              eq(schema.changelogTable.organizationId, organizationId)
            )
          )
          .limit(1);

        const row = rows.at(0);
        if (row === undefined) {
          return Option.none();
        }

        const collections = yield* collectionsByChangelogId(
          [row.id],
          organizationId
        );

        return Option.some(
          toChangelogDetail(row, {
            categories: collections.categories.get(row.id) ?? [],
            linkedPosts: collections.linkedPosts.get(row.id) ?? [],
          })
        );
      }).pipe(withRemapDbErrors("PublicApiChangelog", "select")),

    /**
     * Creates an entry and records what publishing it means.
     *
     * The id is minted by the repository rather than accepted from the caller:
     * a machine key is not a member acting on records it can already see, and a
     * caller-chosen id would make the primary key part of the request surface.
     *
     * The whole write is one transaction that also keeps the entry's editor
     * asset references in step, records the publication email intent, and
     * notifies subscribers. The intent must commit with the status it belongs
     * to: a published entry whose intent rolled back is a release note nobody
     * was told about, and nothing would ever retry it.
     *
     * `allowPublish` is the caller's `changelog.publish` scope. The check
     * lives here rather than in the middleware because a create has no previous
     * status to compare against: the request itself says `published`, so the
     * request is what decides whether the scope is needed.
     */
    create: ({
      allowPublish,
      content,
      coverImage,
      excerpt,
      organizationId,
      publishedAt,
      scheduledAt,
      slug,
      status,
      title,
    }: {
      allowPublish: boolean;
      content: string;
      coverImage: string | null;
      excerpt: string;
      organizationId: string;
      publishedAt: Date | null;
      scheduledAt: Date | null;
      slug: string;
      status: TPublicApiChangelogStatus;
      title: string;
    }) =>
      db
        // The transaction connection is fiber-local, so the repository and the
        // asset service both join it without the callback's handle.
        .transaction(() =>
          Effect.gen(function* () {
            if (status === "published" && !allowPublish) {
              return yield* forbiddenScopeError("changelog.publish");
            }

            const created = yield* changelogs.create({
              content,
              coverImage,
              excerpt,
              organizationId,
              publishedAt,
              scheduledAt,
              slug,
              status,
              title,
            });

            // An insert either stores a row or fails; an empty row here would
            // be a broken invariant, not something the caller did.
            if (created === undefined) {
              return yield* new InternalServerError({
                message: "Error creating PublicApiChangelog",
              });
            }

            yield* syncAssets({
              assetIds: [],
              changelogId: created.id,
              content,
              coverImageUrl: coverImage,
              organizationId,
            });

            const outboxId =
              status === "published"
                ? yield* publication.recordPublishedIntent({
                    changelogId: created.id,
                    organizationId,
                  })
                : undefined;

            if (status === "published") {
              yield* publication.notifyPublished({
                // A machine key is not a member, so there is no actor to
                // exclude from the fan-out and no name to attribute it to.
                actorUserId: null,
                changelogId: created.id,
                changelogSlug: slug,
                organizationId,
                title,
              });
            }

            return {
              entry: toChangelogDetail(created, {
                // A create cannot set labels or links; they are the
                // dashboard's, and a create has none yet.
                categories: [],
                linkedPosts: [],
              }),
              outboxId,
            };
          })
        )
        .pipe(
          withRemapDbErrors({
            action: "create",
            entity: "PublicApiChangelog",
            onUniqueViolation: () =>
              conflictError("A changelog entry with this slug already exists."),
          })
        ),

    /**
     * Replaces an entry's writable fields and records a publish transition.
     *
     * The row is read with `for("update")` before anything is written, so two
     * concurrent requests cannot both see a draft and both record a publish
     * intent; the one that loses waits and then reads the committed status. A
     * missing row is answered as `NOT_FOUND` from inside the transaction
     * rather than as an update that matched nothing and reported success.
     *
     * The publish scope is decided from the locked status: an entry that was
     * unpublished by a request that raced this one must not be republished by
     * a key that never held `changelog.publish`, even if the handler read a
     * published row a moment earlier.
     */
    update: ({
      allowPublish,
      changelogId,
      content,
      coverImage,
      excerpt,
      organizationId,
      publishedAt,
      scheduledAt,
      slug,
      status,
      title,
    }: {
      allowPublish: boolean;
      changelogId: string;
      content: string;
      coverImage: string | null;
      excerpt: string;
      organizationId: string;
      publishedAt: Date | null;
      scheduledAt: Date | null;
      slug: string;
      status: TPublicApiChangelogStatus;
      title: string;
    }) =>
      db
        // The transaction connection is fiber-local, so the repository and the
        // asset service both join it without the callback's handle.
        .transaction(() =>
          Effect.gen(function* () {
            const previousStatus = yield* changelogs.findStatus({
              id: changelogId,
              organizationId,
            });

            if (previousStatus === undefined) {
              return yield* notFoundError("Changelog entry not found.");
            }

            const publishedNow =
              previousStatus !== "published" && status === "published";
            if (publishedNow && !allowPublish) {
              return yield* forbiddenScopeError("changelog.publish");
            }

            const updated = yield* changelogs.update({
              content,
              coverImage,
              excerpt,
              id: changelogId,
              organizationId,
              publishedAt,
              scheduledAt,
              slug,
              status,
              title,
            });

            if (updated === undefined) {
              return yield* new InternalServerError({
                message: "Error updating PublicApiChangelog",
              });
            }

            yield* syncAssets({
              assetIds: [],
              changelogId,
              content,
              coverImageUrl: coverImage,
              organizationId,
            });

            const outboxId = publishedNow
              ? yield* publication.recordPublishedIntent({
                  changelogId,
                  organizationId,
                })
              : undefined;

            if (publishedNow) {
              yield* publication.notifyPublished({
                actorUserId: null,
                changelogId,
                changelogSlug: slug,
                organizationId,
                title,
              });
            }

            // An update does not touch labels or links, but the entry may
            // already carry either from the dashboard, so the response
            // reports what the entry has now rather than an empty pair.
            const collections = yield* collectionsByChangelogId(
              [updated.id],
              organizationId
            );

            return {
              entry: toChangelogDetail(updated, {
                categories: collections.categories.get(updated.id) ?? [],
                linkedPosts: collections.linkedPosts.get(updated.id) ?? [],
              }),
              outboxId,
            };
          })
        )
        .pipe(
          withRemapDbErrors({
            action: "update",
            entity: "PublicApiChangelog",
            onUniqueViolation: () =>
              conflictError("A changelog entry with this slug already exists."),
          })
        ),

    /**
     * Deletes an entry, reports whether one was there to delete, and sweeps
     * what it left behind.
     *
     * `returning` rather than a read followed by a delete: the two would race,
     * and a caller told `204` for an entry that had already been removed by
     * someone else would have no way to know its id was wrong. The linked post
     * rows cascade with the entry.
     *
     * The orphan sweep is the same best-effort one the dashboard runs after
     * its own delete, and it runs only when a row was actually removed. It
     * deletes the asset rows and stored objects no post or changelog
     * references any more — an API caller cannot upload editor assets, but it
     * can delete a dashboard-created entry that referenced them, and leaving
     * them for an unrelated dashboard delete that may never come is a leak.
     * A failed sweep is logged rather than failing the delete that already
     * committed.
     */
    delete: ({
      changelogId,
      organizationId,
    }: {
      changelogId: string;
      organizationId: string;
    }) =>
      changelogs.delete({ id: changelogId, organizationId }).pipe(
        Effect.tap((deleted) =>
          deleted ? cleanupOrphanedAssets(organizationId) : Effect.void
        ),
        withRemapDbErrors("PublicApiChangelog", "delete")
      ),
  };
});

export class PublicApiChangelogRepository extends Context.Service<PublicApiChangelogRepository>()(
  "PublicApiChangelogRepository",
  {
    make: makePublicApiChangelogRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
