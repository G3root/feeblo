import type { TPostActivityKind } from "@feeblo/domain-contracts/activity-kind";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import { statusDisplayName } from "../../post-status/display-name";
import { toPublicApiTag } from "../../tag/public-api/mappers";
import type { PublicApiDetailedPost, PublicApiListedPost } from "./repository";
import type {
  TPublicApiPost,
  TPublicApiPostActivity,
  TPublicApiPostSummary,
} from "./schema";

export type PublicApiMapperContext = {
  /** Application base URL, without a trailing slash. */
  readonly appUrl: string;
  readonly organizationId: string;
};

/**
 * The public board URL for a post. Mirrors the link the dashboard, emails, and
 * webhooks produce, so a caller can hand the same URL back to a human.
 */
const postUrl = (post: PublicApiListedPost, context: PublicApiMapperContext) =>
  [
    context.appUrl,
    encodeURIComponent(context.organizationId),
    "post",
    encodeURIComponent(post.boardSlug),
    encodeURIComponent(post.slug),
  ].join("/");

/**
 * A non-empty status name.
 *
 * The rule lives with the status resource (`statusDisplayName`), which the
 * statuses endpoint uses too, so a post's embedded status and the catalog
 * cannot call the same status two different things.
 */
const statusName = (status: {
  readonly name: string;
  readonly type: TPostStatusType;
}): string => statusDisplayName(status.name, status.type);

/**
 * Row → DTO mappers for the public post contract.
 *
 * Every field is named explicitly. The mappers accept the repository's narrow
 * source types rather than dashboard rows, so a column added to a dashboard
 * read model cannot flow into a public response, and an internal actor
 * identifier has no name here to be passed through. See ADR 0004.
 */
export const toPublicApiPostSummary = (
  post: PublicApiListedPost,
  context: PublicApiMapperContext
): TPublicApiPostSummary => ({
  id: post.id,
  boardId: post.boardId,
  title: post.title,
  slug: post.slug,
  excerpt: post.excerpt,
  url: postUrl(post, context),
  status: {
    id: post.status.id,
    name: statusName(post.status),
    type: post.status.type,
  },
  etaQuarter: post.etaQuarter,
  tags: post.tags.map(toPublicApiTag),
  voteCount: post.voteCount,
  commentCount: post.commentCount,
  author: {
    type: post.author.type,
    displayName: post.author.displayName,
    avatarUrl: post.author.avatarUrl,
  },
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  lockedAt: post.lockedAt,
  archivedAt: post.archivedAt,
  mergedIntoPostId: post.mergedIntoPostId,
});

/** The detail projection: the summary plus the stored, sanitized body. */
export const toPublicApiPost = (
  post: PublicApiDetailedPost,
  context: PublicApiMapperContext
): TPublicApiPost => ({
  ...toPublicApiPostSummary(post, context),
  content: post.content,
});

/**
 * What an activity mapper is allowed to read.
 *
 * The actor arrives already classified — `member`, `end_user`, or `null` for a
 * machine — because the repository computes it in SQL and never selects the
 * actor's user or member id. A column added to `post_activity` cannot reach a
 * public response without being named here first, and the on-behalf metadata
 * has no name here at all.
 */
export type PublicApiPostActivitySource = {
  readonly id: string;
  readonly kind: TPostActivityKind;
  readonly actor: {
    readonly type: "member" | "end_user" | null;
    readonly displayName: string | null;
    readonly avatarUrl: string | null;
  };
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly commentId: string | null;
  readonly createdAt: Date;
};

/** Narrows a repository row to the fields a public response may name. */
export const toActivitySource = (row: {
  readonly id: string;
  readonly kind: TPostActivityKind;
  readonly actorName: string | null;
  readonly actorImage: string | null;
  readonly actorType: "member" | "end_user" | null;
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly commentId: string | null;
  readonly createdAt: Date;
}): PublicApiPostActivitySource => ({
  actor: {
    avatarUrl: row.actorImage,
    displayName: row.actorName,
    type: row.actorType,
  },
  commentId: row.commentId,
  createdAt: row.createdAt,
  id: row.id,
  kind: row.kind,
  nextValue: row.nextValue,
  previousValue: row.previousValue,
});

/**
 * One timeline entry as the activity endpoint returns it.
 *
 * An entry nobody can be named for — one a machine key wrote — reports
 * `actor: null` rather than an invented identity, which is what the dashboard
 * shows as "Someone".
 */
export const toPublicApiPostActivity = (
  entry: PublicApiPostActivitySource
): TPublicApiPostActivity => ({
  actor:
    entry.actor.type === null
      ? null
      : {
          avatarUrl: entry.actor.avatarUrl,
          displayName: entry.actor.displayName,
          type: entry.actor.type,
        },
  commentId: entry.commentId,
  createdAt: entry.createdAt,
  id: entry.id,
  kind: entry.kind,
  nextValue: entry.nextValue,
  previousValue: entry.previousValue,
});
