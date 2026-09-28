import { currentDb, Database, schema } from "@feeblo/db";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { ChangelogId, CompanyId, PostTagId, TagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  cleanupOrphanedEditorAssets,
  syncChangelogAssetReferences,
} from "../asset/service";
import { makeChangelogPublication } from "../changelog/publication";
import { PostActivityRepository } from "../post-activity/repository";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { S3UploadService } from "../services/s3";
import { postTagChangeActivities } from "../tag/post-tag-activities";
import type { Cursor } from "./cursor";
import type { CrmEntryAllowanceError } from "./entitlement";
import {
  conflictError,
  forbiddenScopeError,
  invalidRequestError,
  notFoundError,
} from "./errors";
import type {
  TPublicApiChangelogStatus,
  TPublicApiCompanySourceType,
} from "./schema";

/** An author reduced to a classification and display fields — never an id. */
export type PublicApiPostAuthor = {
  readonly type: "member" | "end_user";
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/** A tag reference: identity and label, and nothing else. */
export type PublicApiPostTag = {
  readonly id: string;
  readonly name: string;
};

/**
 * What a mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept a
 * dashboard row (which carries internal actor ids) and pass it through, and a
 * column added to the `post` table cannot reach a public response without being
 * added here first.
 */
export type PublicApiPostSource = {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly etaQuarter: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lockedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly mergedIntoPostId: string | null;
  readonly status: {
    readonly id: string;
    readonly name: string;
    readonly type: TPostStatusType;
  };
  readonly author: PublicApiPostAuthor;
  readonly voteCount: number;
  readonly commentCount: number;
  readonly tags: readonly PublicApiPostTag[];
};

export type PublicApiListedPost = PublicApiPostSource & {
  readonly boardSlug: string;
};

export type PublicApiDetailedPost = PublicApiPostSource & {
  readonly boardSlug: string;
  readonly content: string;
};

export type PublicApiPostPage = {
  readonly posts: readonly PublicApiListedPost[];
  readonly nextCursor: Cursor | null;
};

/**
 * What the tag mapper is allowed to read.
 *
 * Narrow for the same reason as `PublicApiPostSource`: `tag` also carries
 * `creatorId` and `creatorMemberId`, and a column that is not named here has
 * no way into a public response. A machine key has no member behind it, so
 * those columns would be null for every tag the API creates — an empty field
 * that says nothing and still has to be kept out of the payload.
 */
export type PublicApiTagSource = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PublicApiTagPage = {
  readonly tags: readonly PublicApiTagSource[];
  readonly nextCursor: Cursor | null;
};

/**
 * What the company mapper is allowed to read.
 *
 * Narrow for the same reason as `PublicApiTagSource`: the `company` table also
 * carries `organizationId`, and a key is workspace-scoped, so the column would
 * be the same string on every response while giving a future filter parameter
 * something to be validated against. The attribute-value table is a join away
 * and is not selected either: the public company resource has no custom
 * fields.
 *
 * `source` is typed with the contract's own closed union rather than the
 * internal `EntitySource`, so a new internal source is a compile error here
 * until the public vocabulary names it.
 */
export type PublicApiCompanySource = {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly avatar: string | null;
  readonly externalCreatedAt: Date | null;
  readonly source: TPublicApiCompanySourceType;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/**
 * What a changelog mapper is allowed to read.
 *
 * Narrow for the same reason as the post and tag sources: `changelog` also
 * carries `creatorId` and `creatorMemberId`, and a column that is not named
 * here has no way into a public response. The status vocabulary is the closed
 * literal union from `./schema`, not the dashboard's schema module.
 */
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
};

export type PublicApiCompanyPage = {
  readonly companies: readonly PublicApiCompanySource[];
  readonly nextCursor: Cursor | null;
};

export type PublicApiChangelogDetail = PublicApiChangelogSource & {
  readonly content: string;
};

export type PublicApiChangelogPage = {
  readonly entries: readonly PublicApiChangelogSource[];
  readonly nextCursor: Cursor | null;
};

interface TListChangelog {
  cursor: Cursor | null;
  limit: number;
  organizationId: string;
  status: TPublicApiChangelogStatus | null;
}

interface TFindChangelog {
  changelogId: string;
  organizationId: string;
}

interface TCreateChangelog {
  /** Whether the key holds `changelog.publish`. */
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
}

interface TUpdateChangelog extends TCreateChangelog {
  changelogId: string;
}

interface TDeleteChangelog {
  changelogId: string;
  organizationId: string;
}

interface TListTags {
  cursor: Cursor | null;
  limit: number;
  organizationId: string;
}

interface TFindTag {
  organizationId: string;
  tagId: string;
}

interface TFindTagNameConflict {
  /** The tag being renamed, excluded from its own conflict check. */
  excludeTagId: string | null;
  name: string;
  organizationId: string;
}

interface TCreateTag {
  name: string;
  organizationId: string;
}

interface TUpdateTag {
  name: string;
  organizationId: string;
  tagId: string;
}

interface TDeleteTag {
  organizationId: string;
  tagId: string;
}

interface TSetPostTags {
  organizationId: string;
  postId: string;
  tagIds: readonly string[];
}

interface TListCompanies {
  cursor: Cursor | null;
  limit: number;
  organizationId: string;
}

interface TFindCompany {
  organizationId: string;
  companyId: string;
}

interface TFindCompanyNameConflict {
  /** The company being renamed, excluded from its own conflict check. */
  excludeCompanyId: string | null;
  name: string;
  organizationId: string;
}

interface TFindCompanyExternalIdConflict {
  /** The company being renamed, excluded from its own conflict check. */
  excludeCompanyId: string | null;
  externalId: string;
  organizationId: string;
}

interface TCreateCompany {
  avatar: string | null;
  externalCreatedAt: Date | null;
  externalId: string | null;
  name: string;
  organizationId: string;
  /**
   * The plan's room check, run inside the same transaction as the insert, after
   * the workspace's CRM writes are locked.
   *
   * Passed in rather than decided here: the limit belongs to the plan, not to
   * the table, and the caller is where the policy is known. It is an effect
   * rather than a boolean because the count it decides on has to be read inside
   * this transaction — see `createCompany`.
   */
  ensureRoom: Effect.Effect<void, CrmEntryAllowanceError>;
}

interface TUpdateCompany {
  externalId: string | null | undefined;
  externalCreatedAt: Date | null | undefined;
  avatar: string | null | undefined;
  name: string | undefined;
  organizationId: string;
  companyId: string;
}

interface TDeleteCompany {
  organizationId: string;
  companyId: string;
}

interface TListBoardPosts {
  boardId: string;
  cursor: Cursor | null;
  includeArchived: boolean;
  limit: number;
  organizationId: string;
  statusId: string | null;
}

interface TFindPost {
  organizationId: string;
  postId: string;
}

/**
 * The author classification is computed in SQL.
 *
 * `creatorMemberId` decides whether an author is workspace staff or an outside
 * end user, and it is an internal identifier that must not leave the database.
 * Reducing it to a literal here — rather than selecting it and branching in
 * TypeScript — keeps the identifier out of the result set, out of logs, and out
 * of any error message that might embed a row.
 */
const POST_COLUMNS = {
  id: schema.postTable.id,
  boardId: schema.postTable.boardId,
  boardSlug: schema.boardTable.slug,
  title: schema.postTable.title,
  slug: schema.postTable.slug,
  excerpt: schema.postTable.excerpt,
  etaQuarter: schema.postTable.etaQuarter,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  statusId: schema.postStatusTable.id,
  // User-facing label; a workspace may leave it empty until it customizes the
  // status, in which case the mapper falls back to the canonical type.
  statusLabel: schema.postStatusTable.label,
  statusType: schema.postStatusTable.type,
  authorType: sql<
    "member" | "end_user"
  >`case when ${schema.postTable.creatorMemberId} is null then 'end_user' else 'member' end`,
  // Contact fallback mirrors the dashboard so a widget submission shows the
  // customer's name; the portal deliberately omits it because it serves
  // unauthenticated visitors. A Public API caller is the workspace itself.
  authorName: sql<
    string | null
  >`coalesce(${schema.userTable.name}, ${schema.contactTable.name})`,
  authorAvatarUrl: sql<
    string | null
  >`coalesce(${schema.userTable.image}, ${schema.contactTable.avatar})`,
} as const;

type PostRow = {
  id: string;
  boardId: string;
  boardSlug: string;
  title: string;
  slug: string;
  excerpt: string;
  etaQuarter: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  archivedAt: Date | null;
  mergedIntoPostId: string | null;
  statusId: string;
  statusLabel: string;
  statusType: TPostStatusType;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
};

/**
 * The tag column list, and the only place a tag field is selected from.
 *
 * `creatorId` and `creatorMemberId` are deliberately absent: a tag the API
 * creates has no member behind it, and the dashboard's own actor columns have
 * no business in a public payload even when they are populated.
 */
const TAG_COLUMNS = {
  id: schema.tagTable.id,
  name: schema.tagTable.name,
  slug: schema.tagTable.slug,
  createdAt: schema.tagTable.createdAt,
  updatedAt: schema.tagTable.updatedAt,
} as const;

/**
 * The company column list, and the only place a company field is selected.
 *
 * `organizationId` is deliberately absent: the key is workspace-scoped, so
 * selecting it would put the same identifier on every response and invite a
 * filter parameter that then has to be validated against the caller's key.
 * The contact and attribute-value tables are not joined at all.
 */
const COMPANY_COLUMNS = {
  id: schema.companyTable.id,
  name: schema.companyTable.name,
  externalId: schema.companyTable.externalId,
  avatar: schema.companyTable.avatar,
  externalCreatedAt: schema.companyTable.externalCreatedAt,
  source: schema.companyTable.source,
  createdAt: schema.companyTable.createdAt,
  updatedAt: schema.companyTable.updatedAt,
} as const;

/**
 * The conflict a unique-index race reports.
 *
 * The driver names the constraint it violated, not a field, so a collision
 * that beats the handler's pre-check can only be reported as "one of these two
 * already exists". The pre-check answers the ordinary duplicate with the field
 * it actually found, which is the case a caller can act on.
 */
const COMPANY_UNIQUE_VIOLATION_MESSAGE =
  "A company with this name or externalId already exists.";

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

const toSource = (
  row: PostRow,
  counts: { voteCount: number; commentCount: number },
  tags: readonly PublicApiPostTag[]
): PublicApiPostSource => ({
  id: row.id,
  boardId: row.boardId,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  etaQuarter: row.etaQuarter,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lockedAt: row.lockedAt,
  archivedAt: row.archivedAt,
  mergedIntoPostId: row.mergedIntoPostId,
  status: { id: row.statusId, name: row.statusLabel, type: row.statusType },
  author: {
    type: row.authorType,
    displayName: row.authorName,
    avatarUrl: row.authorAvatarUrl,
  },
  voteCount: counts.voteCount,
  commentCount: counts.commentCount,
  tags,
});

/**
 * The Public API's own queries, rather than the dashboard repositories': the
 * rules differ (a private
 * board is readable with a key, archived and merged posts are handled per
 * request, and vote and comment counts have no dashboard equivalent), and the
 * column list is the first line of defence against exposing actor identities.
 */
const makePublicApiRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const s3 = yield* S3UploadService;
  const activities = yield* PostActivityRepository;
  // Publishing an entry has the same side effects whichever surface wrote it:
  // a durable email intent and an in-app notification for subscribers. The
  // dashboard's write path uses this same constructor, so the two cannot
  // diverge into "the release note nobody received".
  const publication = yield* makeChangelogPublication;

  /**
   * Keeps an entry's editor-asset references in step with its content.
   *
   * The asset service reads the database from the fiber context, which would
   * put a raw `Database` requirement on every handler that calls a write —
   * and `HttpApiBuilder` threads a handler effect's requirements into the
   * route layer, where the composition root cannot satisfy a request it has
   * already fulfilled. Providing the handle this repository already holds
   * removes it. The open transaction is fiber-local, not a service, so the
   * write still lands in the transaction that is running when this is called.
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

  const countByPostIds = (postIds: readonly string[]) =>
    Effect.gen(function* () {
      const voteRows = yield* db
        .select({
          postId: schema.upvoteTable.postId,
          total: count(schema.upvoteTable.id),
        })
        .from(schema.upvoteTable)
        .where(inArray(schema.upvoteTable.postId, postIds))
        .groupBy(schema.upvoteTable.postId);

      // Only public comments are counted: an internal comment is a workspace
      // note, and counting it would make this number disagree with the same
      // post's count on the public portal.
      const commentRows = yield* db
        .select({
          postId: schema.commentTable.postId,
          total: count(schema.commentTable.id),
        })
        .from(schema.commentTable)
        .where(
          and(
            inArray(schema.commentTable.postId, postIds),
            eq(schema.commentTable.visibility, "PUBLIC")
          )
        )
        .groupBy(schema.commentTable.postId);

      return {
        voteCount: new Map(
          voteRows.map((row) => [row.postId, Number(row.total)])
        ),
        commentCount: new Map(
          commentRows.map((row) => [row.postId, Number(row.total)])
        ),
      };
    });

  const tagsByPostIds = (postIds: readonly string[]) =>
    db
      .select({
        postId: schema.postTagTable.postId,
        id: schema.tagTable.id,
        name: schema.tagTable.name,
      })
      .from(schema.postTagTable)
      .innerJoin(
        schema.tagTable,
        eq(schema.tagTable.id, schema.postTagTable.tagId)
      )
      .where(inArray(schema.postTagTable.postId, postIds))
      // Ordered so a post's tag array is stable across requests. The contract
      // does not promise an order, but a caller diffing two responses of the
      // same post should not see it shuffle.
      .orderBy(asc(schema.tagTable.name));

  return {
    /**
     * One page of a board's posts, newest first.
     *
     * Fetches `limit + 1` rows so the caller learns whether another page exists
     * without a second query, and pages on `(createdAt, id)` — the same tuple
     * the cursor carries — so concurrently inserted posts cannot make a caller
     * skip or repeat a row the way an offset would.
     */
    listBoardPosts: ({
      boardId,
      cursor,
      includeArchived,
      limit,
      organizationId,
      statusId,
    }: TListBoardPosts) =>
      Effect.gen(function* () {
        // Distinguish an empty board from one that does not exist in this
        // workspace before running the page query: otherwise both come back as
        // a successful empty page, and the caller cannot tell them apart. A
        // board of another workspace is reported the same way as a missing
        // one, so the id cannot be used to probe other workspaces.
        const board = yield* db
          .select({ id: schema.boardTable.id })
          .from(schema.boardTable)
          .where(
            and(
              eq(schema.boardTable.id, boardId),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (board.length === 0) {
          return Option.none();
        }

        const conditions: SQL[] = [
          eq(schema.postTable.organizationId, organizationId),
          eq(schema.postTable.boardId, boardId),
          // A merged post is superseded by its survivor. Same rule as the
          // portal, and it keeps `mergedIntoPostId` meaningful rather than
          // listing duplicates.
          isNull(schema.postTable.mergedIntoPostId),
        ];
        if (!includeArchived) {
          conditions.push(isNull(schema.postTable.archivedAt));
        }
        if (statusId !== null) {
          conditions.push(eq(schema.postTable.statusId, statusId));
        }
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.postTable.createdAt}, ${schema.postTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(POST_COLUMNS)
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
            schema.userTable,
            eq(schema.userTable.id, schema.postTable.creatorId)
          )
          .leftJoin(
            schema.contactTable,
            eq(schema.contactTable.id, schema.postTable.contactId)
          )
          .where(and(...conditions))
          .orderBy(desc(schema.postTable.createdAt), desc(schema.postTable.id))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        if (pageRows.length === 0) {
          return Option.some({ posts: [], nextCursor: null });
        }

        const postIds = pageRows.map((row) => row.id);
        const counts = yield* countByPostIds(postIds);
        const tagRows = yield* tagsByPostIds(postIds);

        const tagsByPost = new Map<string, { id: string; name: string }[]>();
        for (const tag of tagRows) {
          const existing = tagsByPost.get(tag.postId) ?? [];
          existing.push({ id: tag.id, name: tag.name });
          tagsByPost.set(tag.postId, existing);
        }

        const lastRow = pageRows[pageRows.length - 1];

        return Option.some({
          posts: pageRows.map((row) => ({
            ...toSource(
              row,
              {
                voteCount: counts.voteCount.get(row.id) ?? 0,
                commentCount: counts.commentCount.get(row.id) ?? 0,
              },
              tagsByPost.get(row.id) ?? []
            ),
            boardSlug: row.boardSlug,
          })),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        });
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /** A single post, including its stored (already sanitized) body. */
    findPost: ({ organizationId, postId }: TFindPost) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ ...POST_COLUMNS, content: schema.postTable.content })
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
            schema.userTable,
            eq(schema.userTable.id, schema.postTable.creatorId)
          )
          .leftJoin(
            schema.contactTable,
            eq(schema.contactTable.id, schema.postTable.contactId)
          )
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        const row = rows.at(0);
        if (row === undefined) {
          return Option.none();
        }

        const counts = yield* countByPostIds([row.id]);
        const tagRows = yield* tagsByPostIds([row.id]);

        return Option.some({
          ...toSource(
            row,
            {
              voteCount: counts.voteCount.get(row.id) ?? 0,
              commentCount: counts.commentCount.get(row.id) ?? 0,
            },
            tagRows.map((tag) => ({ id: tag.id, name: tag.name }))
          ),
          boardSlug: row.boardSlug,
          content: row.content,
        });
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /**
     * One page of the workspace's tags, newest first.
     *
     * Ordered and paged exactly like a board's posts — the same `(createdAt,
     * id)` tuple and the same cursor — so a caller learns one paging rule for
     * the whole API. Fetches `limit + 1` rows to learn whether another page
     * exists without a second query.
     */
    listTags: ({ cursor, limit, organizationId }: TListTags) =>
      Effect.gen(function* () {
        const conditions: SQL[] = [
          eq(schema.tagTable.organizationId, organizationId),
        ];
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.tagTable.createdAt}, ${schema.tagTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(TAG_COLUMNS)
          .from(schema.tagTable)
          .where(and(...conditions))
          .orderBy(desc(schema.tagTable.createdAt), desc(schema.tagTable.id))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        return {
          tags: pageRows,
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiTagPage;
      }).pipe(withRemapDbErrors("PublicApiTag", "select")),

    /** One tag of the calling workspace, or nothing. */
    findTag: ({ organizationId, tagId }: TFindTag) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(TAG_COLUMNS)
          .from(schema.tagTable)
          .where(
            and(
              eq(schema.tagTable.id, tagId),
              eq(schema.tagTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiTag", "select")),

    /**
     * The tag that already holds this name or slug, if any.
     *
     * Takes the name rather than a slug so that the slug rule lives in exactly
     * one place: a pre-check that derived the slug differently from the insert
     * would let a caller through to an index violation it could not explain.
     * Both indexes are checked together because they are two spellings of the
     * same collision — `UI Kit` and `ui-kit` slugify alike — and a caller told
     * only about the name would retry and hit the other index instead.
     */
    findTagNameConflict: ({
      excludeTagId,
      name,
      organizationId,
    }: TFindTagNameConflict) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.tagTable.id })
          .from(schema.tagTable)
          .where(
            and(
              eq(schema.tagTable.organizationId, organizationId),
              or(
                eq(schema.tagTable.name, name),
                eq(schema.tagTable.slug, slugify(name))
              ),
              ...(excludeTagId === null
                ? []
                : [ne(schema.tagTable.id, excludeTagId)])
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiTag", "select")),

    /**
     * Creates a tag and returns the row the database stored.
     *
     * The id is minted here rather than accepted from the caller: the
     * dashboard generates ids client-side because a member acts on records
     * they can already see, but a machine key is not a member, and a
     * caller-chosen id would make the primary key part of the request surface.
     *
     * The unique violation is mapped as well as pre-checked, because two
     * concurrent creates of the same name both pass the check and one of them
     * then loses the race at the index.
     */
    createTag: ({ name, organizationId }: TCreateTag) =>
      Effect.gen(function* () {
        const id = yield* TagId.generate;
        const now = yield* DateTime.nowAsDate;

        const [created] = yield* db
          .insert(schema.tagTable)
          .values({
            id,
            name,
            slug: slugify(name),
            organizationId,
            createdAt: now,
            updatedAt: now,
          })
          .returning(TAG_COLUMNS);

        // An insert either stores a row or fails; an empty `returning` is a
        // broken invariant, not something the caller did, so it must not be
        // reported as a conflict with a name nobody holds.
        if (created === undefined) {
          return yield* Effect.fail(
            new InternalServerError({
              message: "Error creating PublicApiTag",
            })
          );
        }

        return created satisfies PublicApiTagSource;
      }).pipe(
        withRemapDbErrors({
          action: "create",
          entity: "PublicApiTag",
          onUniqueViolation: () =>
            conflictError("A tag with this name already exists."),
        })
      ),

    /** Renames a tag and returns the row the database stored. */
    updateTag: ({ name, organizationId, tagId }: TUpdateTag) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;

        const [updated] = yield* db
          .update(schema.tagTable)
          .set({ name, slug: slugify(name), updatedAt: now })
          .where(
            and(
              eq(schema.tagTable.id, tagId),
              eq(schema.tagTable.organizationId, organizationId)
            )
          )
          .returning(TAG_COLUMNS);

        // The handler reads the tag before renaming it, so a row that is gone
        // by the time the update runs is a race, not a caller mistake.
        if (updated === undefined) {
          return yield* Effect.fail(
            new InternalServerError({
              message: "Error updating PublicApiTag",
            })
          );
        }

        return updated satisfies PublicApiTagSource;
      }).pipe(
        withRemapDbErrors({
          action: "update",
          entity: "PublicApiTag",
          onUniqueViolation: () =>
            conflictError("A tag with this name already exists."),
        })
      ),

    /**
     * Deletes a tag and its post assignments.
     *
     * `post_tag.tag_id` cascades, so a deleted tag stops labelling every post
     * it was on — the same behaviour as deleting it in the dashboard.
     */
    deleteTag: ({ organizationId, tagId }: TDeleteTag) =>
      db
        .delete(schema.tagTable)
        .where(
          and(
            eq(schema.tagTable.id, tagId),
            eq(schema.tagTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid, withRemapDbErrors("PublicApiTag", "delete")),

    /**
     * Replaces a post's tags and returns the tags it carries afterwards.
     *
     * A replacement rather than add and remove calls, so a caller that states
     * the final set cannot leave a tag behind by forgetting to remove it. The
     * post is locked first, then the check, the write, the timeline entries,
     * and the read-back all run in that one transaction: two replacements of
     * the same post cannot interleave into a set neither caller asked for, a
     * tag or post that disappears mid-request is answered as the missing
     * resource it is rather than as a foreign-key failure, the response is
     * exactly what a later read returns, and a post cannot end up tagged with
     * no record of the change in its history.
     *
     * Only the rows that actually change are written. `post_tag` carries
     * `merged_from_post_id` on the rows a merge moved onto this post, and the
     * unmerge path restores exactly those rows to their source; deleting and
     * re-inserting an unchanged tag would clear that provenance and strand the
     * tag on the survivor for good.
     *
     * The recorded actor is null because a machine key is not a member. The
     * `post_activity` columns allow that and the dashboard renders those
     * entries as "Someone" — which is true, and better than a post whose tags
     * change with no entry in its history at all.
     */
    setPostTags: ({ organizationId, postId, tagIds }: TSetPostTags) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            // Deduplicated here rather than by the caller: the check below
            // compares distinct rows, so the same id twice would otherwise look
            // like a tag the workspace does not have.
            const wanted = [...new Set(tagIds)];

            // The post is read before anything else, and locked. Without the
            // lock, two replacements of one post both read the same previous
            // set and each inserts only its own additions, leaving the post
            // with a union of the two requests — `[A, B]` and `[A, C]` would
            // end as `[A, B, C]`. The lock makes the second wait here, and the
            // reads below then happen in a snapshot that includes the first
            // one's rows, so the last writer's set is the set that survives.
            //
            // `no key update` rather than `update`: this row is pointed at by
            // foreign keys across the workspace, and the stronger lock would
            // block unrelated inserts that merely reference this post.
            const post = yield* tx
              .select({ id: schema.postTable.id })
              .from(schema.postTable)
              .where(
                and(
                  eq(schema.postTable.id, postId),
                  eq(schema.postTable.organizationId, organizationId)
                )
              )
              .for("no key update");

            if (post.length === 0) {
              return yield* Effect.fail(notFoundError("Post not found."));
            }

            if (wanted.length > 0) {
              // `for("key share")` is the lock the foreign-key check itself
              // takes: a tag deleted concurrently either loses the race and is
              // missing from this read, or waits here until these rows exist
              // and then cascades them away with it.
              const known = yield* tx
                .select({ id: schema.tagTable.id })
                .from(schema.tagTable)
                .where(
                  and(
                    eq(schema.tagTable.organizationId, organizationId),
                    inArray(schema.tagTable.id, wanted)
                  )
                )
                .for("key share");

              if (known.length !== wanted.length) {
                return yield* Effect.fail(
                  invalidRequestError(
                    "One or more tagIds do not exist in this workspace."
                  )
                );
              }
            }

            const previous = yield* tx
              .select({ tagId: schema.postTagTable.tagId })
              .from(schema.postTagTable)
              .where(
                and(
                  eq(schema.postTagTable.postId, postId),
                  eq(schema.postTagTable.organizationId, organizationId)
                )
              );
            const previousTagIds = previous.map((row) => row.tagId);
            const previousSet = new Set(previousTagIds);
            const nextSet = new Set(wanted);

            const removed = previousTagIds.filter(
              (tagId) => !nextSet.has(tagId)
            );
            if (removed.length > 0) {
              yield* tx
                .delete(schema.postTagTable)
                .where(
                  and(
                    eq(schema.postTagTable.postId, postId),
                    eq(schema.postTagTable.organizationId, organizationId),
                    inArray(schema.postTagTable.tagId, removed)
                  )
                )
                .pipe(Effect.asVoid);
            }

            const added = wanted.filter((tagId) => !previousSet.has(tagId));
            if (added.length > 0) {
              const rows = yield* Effect.forEach(added, (tagId) =>
                PostTagId.generate.pipe(
                  Effect.map((id) => ({
                    id,
                    postId,
                    tagId,
                    organizationId,
                    createdAt: now,
                    updatedAt: now,
                  }))
                )
              );

              // `post_tag_postId_tagId_uidx` would abort the transaction if a
              // concurrent request inserted the same tag first; the ids are
              // deduplicated above, so this is the backstop rather than the
              // rule.
              yield* tx
                .insert(schema.postTagTable)
                .values(rows)
                .onConflictDoNothing()
                .pipe(Effect.asVoid);
            }

            // The activity repository holds its own database handle, and
            // `withTransaction` keeps the connection in fiber-local context,
            // so these rows are written in the same transaction as the tags
            // above rather than in a second one that could fail alone.
            yield* activities.createMany(
              postTagChangeActivities({
                previousTagIds,
                nextTagIds: wanted,
                actor: {
                  actorId: null,
                  actorMemberId: null,
                  organizationId,
                  postId,
                },
              })
            );

            const tags = yield* tx
              .select({ id: schema.tagTable.id, name: schema.tagTable.name })
              .from(schema.postTagTable)
              .innerJoin(
                schema.tagTable,
                eq(schema.tagTable.id, schema.postTagTable.tagId)
              )
              .where(
                and(
                  eq(schema.postTagTable.postId, postId),
                  eq(schema.postTagTable.organizationId, organizationId)
                )
              )
              .orderBy(asc(schema.tagTable.name));

            return tags satisfies readonly PublicApiPostTag[];
          })
        )
        .pipe(withRemapDbErrors("PublicApiTag", "update")),

    /**
     * One page of the workspace's companies, newest first.
     *
     * Ordered and paged exactly like a board's posts and the workspace's tags —
     * the same `(createdAt, id)` tuple and the same cursor — so a caller learns
     * one paging rule for the whole API. Fetches `limit + 1` rows to learn
     * whether another page exists without a second query.
     */
    listCompanies: ({ cursor, limit, organizationId }: TListCompanies) =>
      Effect.gen(function* () {
        const conditions: SQL[] = [
          eq(schema.companyTable.organizationId, organizationId),
        ];
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.companyTable.createdAt}, ${schema.companyTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(COMPANY_COLUMNS)
          .from(schema.companyTable)
          .where(and(...conditions))
          .orderBy(
            desc(schema.companyTable.createdAt),
            desc(schema.companyTable.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        return {
          companies: pageRows,
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiCompanyPage;
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /** One company of the calling workspace, or nothing. */
    findCompany: ({ organizationId, companyId }: TFindCompany) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(COMPANY_COLUMNS)
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.id, companyId),
              eq(schema.companyTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /**
     * The company that already holds this name, if any.
     *
     * `company_organizationId_name_uidx` is the authority; this is the courtesy
     * check that lets an ordinary duplicate be answered with a message about
     * the name instead of a driver error the caller cannot act on.
     */
    findCompanyNameConflict: ({
      excludeCompanyId,
      name,
      organizationId,
    }: TFindCompanyNameConflict) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.organizationId, organizationId),
              eq(schema.companyTable.name, name),
              ...(excludeCompanyId === null
                ? []
                : [ne(schema.companyTable.id, excludeCompanyId)])
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /**
     * The company that already holds this external id, if any.
     *
     * Looked up separately from the name so the message can say which field
     * collided: `externalId` is the caller's own identifier, and being told
     * that a *name* is taken when the caller reused a sync key would send them
     * looking in the wrong place. Postgres treats `NULL` as distinct in a
     * unique index, so an unset external id never conflicts with another unset
     * one and is never passed here.
     */
    findCompanyExternalIdConflict: ({
      excludeCompanyId,
      externalId,
      organizationId,
    }: TFindCompanyExternalIdConflict) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.organizationId, organizationId),
              eq(schema.companyTable.externalId, externalId),
              ...(excludeCompanyId === null
                ? []
                : [ne(schema.companyTable.id, excludeCompanyId)])
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /**
     * Creates a company, in the transaction that proves the plan has room.
     *
     * The plan's entry limit counts rows that mostly do not exist yet, so there
     * is no row among them to lock: two creates arriving near the cap would both
     * count the entries committed so far and both see room. The workspace row is
     * locked instead, which gives them one order — the second create waits here,
     * then counts the first one's row — and `ensureRoom` runs after that lock and
     * before the insert, so the number it reads and the row it authorizes are
     * decided together rather than a statement apart.
     *
     * `no key update` rather than `update`, for the reason the tag write gives:
     * every table in the workspace points at this row, and the stronger lock
     * would block unrelated inserts that merely reference the workspace.
     *
     * The id is minted here rather than accepted from the caller, for the same
     * reason as a tag's: a machine key is not a member acting on records it can
     * already see, and a caller-chosen id would make the primary key part of the
     * request surface. The caller's own identifier belongs in `externalId`.
     *
     * `source` is written as `API` rather than taken from the request: it is
     * this API's record of where the row came from, and a caller that could
     * claim `DASHBOARD` would make the dashboard's own provenance column
     * lie. A company the widget provisions stays `WIDGET`.
     *
     * Both unique indexes are mapped as well as pre-checked, because two
     * concurrent creates collide after both checks pass and one of them then
     * loses the race at an index. That fallback cannot say which of the two
     * collided — the driver reports a constraint, not a field — so it names
     * both rather than guessing; the pre-check has already answered the
     * ordinary case with the precise field. The mapping wraps the transaction
     * rather than the statement so a failure that only surfaces on commit is
     * answered on the same vocabulary.
     */
    createCompany: ({
      avatar,
      ensureRoom,
      externalCreatedAt,
      externalId,
      name,
      organizationId,
    }: TCreateCompany) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const id = yield* CompanyId.generate;
            const now = yield* DateTime.nowAsDate;

            yield* tx
              .select({ id: schema.organizationTable.id })
              .from(schema.organizationTable)
              .where(eq(schema.organizationTable.id, organizationId))
              .for("no key update");

            yield* ensureRoom;

            const [created] = yield* tx
              .insert(schema.companyTable)
              .values({
                id,
                name,
                externalId,
                avatar,
                externalCreatedAt,
                organizationId,
                source: "API",
                createdAt: now,
                updatedAt: now,
              })
              .returning(COMPANY_COLUMNS);

            // An insert either stores a row or fails; an empty `returning` is a
            // broken invariant, not something the caller did, so it must not be
            // reported as a conflict with a name nobody holds.
            if (created === undefined) {
              return yield* Effect.fail(
                new InternalServerError({
                  message: "Error creating PublicApiCompany",
                })
              );
            }

            return created satisfies PublicApiCompanySource;
          })
        )
        .pipe(
          withRemapDbErrors({
            action: "create",
            entity: "PublicApiCompany",
            onUniqueViolation: () =>
              conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
          })
        ),

    /**
     * Applies the fields the request named and returns the row the database
     * stored, or nothing when there is no such company any more.
     *
     * `None` rather than a failure: the handler reads the company before calling
     * this, so an update that matches no row was raced by someone else's delete,
     * and the honest answer to the caller is the documented "not found" rather
     * than a server error for a request they made in good faith. The unique
     * violation is still mapped, because a rename can lose the race at the index
     * even though the pre-check passed.
     */
    updateCompany: ({
      avatar,
      companyId,
      externalCreatedAt,
      externalId,
      name,
      organizationId,
    }: TUpdateCompany) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;

        const rows = yield* db
          .update(schema.companyTable)
          .set({
            ...(name !== undefined && { name }),
            ...(externalId !== undefined && { externalId }),
            ...(avatar !== undefined && { avatar }),
            ...(externalCreatedAt !== undefined && { externalCreatedAt }),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.companyTable.id, companyId),
              eq(schema.companyTable.organizationId, organizationId)
            )
          )
          .returning(COMPANY_COLUMNS);

        return Option.fromNullishOr(
          rows.at(0)
        ) satisfies Option.Option<PublicApiCompanySource>;
      }).pipe(
        withRemapDbErrors({
          action: "update",
          entity: "PublicApiCompany",
          onUniqueViolation: () =>
            conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
        })
      ),

    /**
     * Deletes a company and reports whether there was one to delete.
     *
     * `false` rather than a silent success: the handler reads the company
     * before calling this, so a delete that matched no row was raced by someone
     * else's delete, and a caller who named the wrong workspace is owed the
     * documented "not found" rather than a success that hides it. The changelog
     * delete answers the same way.
     *
     * `contact.companyId` is `set null`, so the people who belonged to the
     * company survive it and keep their own records — the same behaviour as
     * deleting it in the dashboard. The company's attribute values cascade.
     */
    deleteCompany: ({ organizationId, companyId }: TDeleteCompany) =>
      db
        .delete(schema.companyTable)
        .where(
          and(
            eq(schema.companyTable.id, companyId),
            eq(schema.companyTable.organizationId, organizationId)
          )
        )
        .returning({ id: schema.companyTable.id })
        .pipe(
          Effect.map((rows) => rows.length > 0),
          withRemapDbErrors("PublicApiCompany", "delete")
        ),

    /**
     * How many CRM entries the workspace holds, for the plan's entry limit.
     *
     * Counts rows and selects nothing: this API does not return contacts, but
     * the plan limit that gates creating a company counts them, and the
     * dashboard's own create is gated on the same number. Two queries rather
     * than one union, because each then uses its own `organizationId` index.
     *
     * Only meaningful inside the write transaction that holds the workspace
     * lock (`createCompany`): read anywhere else, the number it returns can be
     * stale by the time the row it authorizes is inserted.
     */
    countCrmEntries: (organizationId: string) =>
      Effect.gen(function* () {
        const [companyRows, contactRows] = yield* Effect.all([
          db
            .select({ total: count(schema.companyTable.id) })
            .from(schema.companyTable)
            .where(eq(schema.companyTable.organizationId, organizationId)),
          db
            .select({ total: count(schema.contactTable.id) })
            .from(schema.contactTable)
            .where(eq(schema.contactTable.organizationId, organizationId)),
        ]);

        return (
          Number(companyRows.at(0)?.total ?? 0) +
          Number(contactRows.at(0)?.total ?? 0)
        );
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),
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
    listChangelog: ({
      cursor,
      limit,
      organizationId,
      status,
    }: TListChangelog) =>
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

        return {
          entries: pageRows,
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiChangelogPage;
      }).pipe(withRemapDbErrors("PublicApiChangelog", "select")),

    /** One entry of the calling workspace, body included, or nothing. */
    findChangelog: ({ changelogId, organizationId }: TFindChangelog) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            ...CHANGELOG_COLUMNS,
            content: schema.changelogTable.content,
          })
          .from(schema.changelogTable)
          .where(
            and(
              eq(schema.changelogTable.id, changelogId),
              eq(schema.changelogTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiChangelog", "select")),

    /**
     * Creates an entry and records what publishing it means.
     *
     * The id is minted here rather than accepted from the caller, for the same
     * reason a tag's is: a machine key is not a member acting on records it
     * can already see, and a caller-chosen id would make the primary key part
     * of the request surface. The slug is always the one `slugify` produced,
     * so `UI Kit` and `ui-kit` are one entry rather than two, and the unique
     * index answers the loser with `CONFLICT` instead of a driver error.
     *
     * The whole write is one transaction that also keeps the entry's editor
     * asset references in step, records the publication email intent, and
     * notifies subscribers. The intent must commit with the status it belongs
     * to: a published entry whose intent rolled back is a release note nobody
     * was told about, and nothing would ever retry it.
     *
     * `allowPublish` is the caller's `changelog.publish` scope. The check
     * lives here rather than in the middleware because a create has no
     * previous status to compare against: the request itself says `published`,
     * so the request is what decides whether the scope is needed.
     */
    createChangelog: ({
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
    }: TCreateChangelog) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            if (status === "published" && !allowPublish) {
              return yield* Effect.fail(
                forbiddenScopeError("changelog.publish")
              );
            }

            const id = yield* ChangelogId.generate;
            const now = yield* DateTime.nowAsDate;

            const [created] = yield* tx
              .insert(schema.changelogTable)
              .values({
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
                createdAt: now,
                updatedAt: now,
              })
              .returning(CHANGELOG_DETAIL_COLUMNS);

            // An insert either stores a row or fails; an empty `returning` is
            // a broken invariant, not something the caller did.
            if (created === undefined) {
              return yield* Effect.fail(
                new InternalServerError({
                  message: "Error creating PublicApiChangelog",
                })
              );
            }

            yield* syncAssets({
              assetIds: [],
              changelogId: id,
              content,
              coverImageUrl: coverImage,
              organizationId,
            });

            const outboxId =
              status === "published"
                ? yield* publication.recordPublishedIntent({
                    changelogId: id,
                    organizationId,
                  })
                : undefined;

            if (status === "published") {
              yield* publication.notifyPublished({
                // A machine key is not a member, so there is no actor to
                // exclude from the fan-out and no name to attribute it to.
                actorUserId: null,
                changelogId: id,
                changelogSlug: slug,
                organizationId,
                title,
              });
            }

            return { entry: created, outboxId };
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
    updateChangelog: ({
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
    }: TUpdateChangelog) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const previous = yield* tx
              .select({ status: schema.changelogTable.status })
              .from(schema.changelogTable)
              .where(
                and(
                  eq(schema.changelogTable.id, changelogId),
                  eq(schema.changelogTable.organizationId, organizationId)
                )
              )
              .limit(1)
              .for("update");

            const previousStatus = previous.at(0)?.status;
            if (previousStatus === undefined) {
              return yield* Effect.fail(
                notFoundError("Changelog entry not found.")
              );
            }

            const publishedNow =
              previousStatus !== "published" && status === "published";
            if (publishedNow && !allowPublish) {
              return yield* Effect.fail(
                forbiddenScopeError("changelog.publish")
              );
            }

            const now = yield* DateTime.nowAsDate;
            const [updated] = yield* tx
              .update(schema.changelogTable)
              .set({
                title,
                slug,
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
                  eq(schema.changelogTable.id, changelogId),
                  eq(schema.changelogTable.organizationId, organizationId)
                )
              )
              .returning(CHANGELOG_DETAIL_COLUMNS);

            if (updated === undefined) {
              return yield* Effect.fail(
                new InternalServerError({
                  message: "Error updating PublicApiChangelog",
                })
              );
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

            return { entry: updated, outboxId };
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
    deleteChangelog: ({ changelogId, organizationId }: TDeleteChangelog) =>
      db
        .delete(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, changelogId),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .returning({ id: schema.changelogTable.id })
        .pipe(
          Effect.tap((rows) =>
            rows.length === 0
              ? Effect.void
              : cleanupOrphanedAssets(organizationId)
          ),
          Effect.map((rows) => rows.length > 0),
          withRemapDbErrors("PublicApiChangelog", "delete")
        ),
  };
});

export class PublicApiRepository extends Context.Service<PublicApiRepository>()(
  "PublicApiRepository",
  {
    make: makePublicApiRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentHttpApiSession`.
 */
export const currentPublicApiRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiRepository))
);
