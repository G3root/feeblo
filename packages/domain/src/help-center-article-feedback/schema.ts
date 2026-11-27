import { HelpCenterArticleId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * One reader's verdict, as the portal writes it.
 *
 * A stored verdict is identified by a session or by a browser-generated id,
 * never both and never neither. A signed-in caller may still send `visitorId`:
 * it names the anonymous verdict the account's vote supersedes, so signing in
 * mid-vote moves the judgment instead of losing it. `visitorId` is a random
 * UUID the page keeps in `localStorage` — not a fingerprint, not a hash of
 * anything — so it dedupes a casual repeat vote the same way the view beacon
 * dedupes a reload. The dashboard's per-article reason list is what makes an
 * unhelpful vote actionable, and it is manager-only.
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
 * The two counts are the standing verdict distribution the feedback table
 * aggregates; they are returned with the reader's own verdict so a vote can
 * update the widget without refetching the whole article. The article's public
 * payload no longer carries them — the page reads this response for the
 * verdict widget, and the dashboard's article rows carry their own counters. There is no `viewCount`: views belong to the article, and a
 * verdict mutation has no reason to restate a number it cannot change.
 */
export const HelpCenterArticleFeedbackPublic = S.Struct({
  helpfulCount: S.Finite,
  notHelpfulCount: S.Finite,
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

/** How many verdicts a list returns when the caller names no `limit`. */
export const HELP_CENTER_ARTICLE_FEEDBACK_LIST_DEFAULT_LIMIT = 20;

/** The most a reason panel may ask for; a list is a preview, not an export. */
const HELP_CENTER_ARTICLE_FEEDBACK_LIST_MAX_LIMIT = 50;

/**
 * The dashboard's verdict list, newest first.
 *
 * `reasonsOnly` is the "what was missing" panel: unhelpful votes that left a
 * reason, which is the one shape of verdict a manager can act on. `limit`
 * bounds that panel rather than a page of history — a reason list is a preview,
 * and one workspace's verdicts must not be able to turn it into an export.
 * Both are optional, so the caller that only scopes the list sends only the two
 * scoping ids.
 */
export const HelpCenterArticleFeedbackList = S.Struct({
  organizationId: WorkspaceId.schema,
  articleId: S.optional(HelpCenterArticleId.schema),
  limit: S.optional(
    S.Int.pipe(
      S.check(S.isGreaterThanOrEqualTo(1)),
      S.check(
        S.isLessThanOrEqualTo(HELP_CENTER_ARTICLE_FEEDBACK_LIST_MAX_LIMIT)
      )
    )
  ),
  reasonsOnly: S.optional(S.Boolean),
});

export type THelpCenterArticleFeedbackList = S.Schema.Type<
  typeof HelpCenterArticleFeedbackList
>;
