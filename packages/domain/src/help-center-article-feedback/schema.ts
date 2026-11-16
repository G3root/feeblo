import { HelpCenterArticleId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

import { HelpCenterArticleCounts } from "../help-center-article/schema";

/**
 * One reader's verdict, as the portal writes it.
 *
 * A reader is identified by a session or by a browser-generated id, never both
 * and never neither. `visitorId` is a random UUID the page keeps in
 * `localStorage` — not a fingerprint, not a hash of anything — so it dedupes a
 * casual repeat vote the same way the view beacon dedupes a reload. The
 * dashboard's per-article reason list is what makes an unhelpful vote
 * actionable, and it is manager-only.
 */
export const HelpCenterArticleFeedbackCast = S.Struct({
  organizationId: WorkspaceId.schema,
  articleId: HelpCenterArticleId.schema,
  helpful: S.Boolean,
  /** Only meaningful on an unhelpful vote; cleared when the vote flips. */
  reason: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(2000))))),
  visitorId: S.optional(S.NullOr(S.String.pipe(S.check(S.isUUID(4))))),
});

export type THelpCenterArticleFeedbackCast = S.Schema.Type<
  typeof HelpCenterArticleFeedbackCast
>;

/**
 * What the portal reads to render "you found this helpful".
 *
 * The two counts are the same aggregate the article payload carries; they are
 * repeated here so a vote response can update the widget without refetching the
 * whole article.
 */
export const HelpCenterArticleFeedbackPublic = S.Struct({
  ...HelpCenterArticleCounts.fields,
  /** This reader's verdict, or null when they have not voted. */
  mine: S.NullOr(S.Boolean),
});

export type THelpCenterArticleFeedbackPublic = S.Schema.Type<
  typeof HelpCenterArticleFeedbackPublic
>;

/** The portal's read of one article's verdicts, scoped to the caller. */
export const HelpCenterArticleFeedbackGetPublic = S.Struct({
  organizationId: WorkspaceId.schema,
  articleId: HelpCenterArticleId.schema,
  visitorId: S.optional(S.NullOr(S.String.pipe(S.check(S.isUUID(4))))),
});

export type THelpCenterArticleFeedbackGetPublic = S.Schema.Type<
  typeof HelpCenterArticleFeedbackGetPublic
>;

/**
 * One stored verdict, as the dashboard reads it.
 *
 * `reason` is free text rendered as text, never as Markdown: there is no
 * renderer on this path and sanitizing it would imply one.
 */
export const HelpCenterArticleFeedback = S.Struct({
  id: S.String,
  articleId: S.String,
  articleTitle: S.String,
  helpful: S.Boolean,
  reason: S.NullOr(S.String),
  authorName: S.NullOr(S.String),
  createdAt: S.DateFromString,
});

export type THelpCenterArticleFeedback = S.Schema.Type<
  typeof HelpCenterArticleFeedback
>;

/** Newest first, across the workspace or for one article. */
export const HelpCenterArticleFeedbackList = S.Struct({
  organizationId: WorkspaceId.schema,
  articleId: S.optional(HelpCenterArticleId.schema),
});

export type THelpCenterArticleFeedbackList = S.Schema.Type<
  typeof HelpCenterArticleFeedbackList
>;
