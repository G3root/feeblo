import { Database, schema, transaction } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { EmailSubscriptionTopic } from "../email-subscription/schema";
import type { PostBoardVisibility } from "./access";
import type {
  ChangelogTemplatePayload,
  EmailIntentPayload,
  EmailOutboxRecord,
  NotificationTemplatePayload,
} from "./schema";

type ChangelogNotificationContent = {
  readonly template: "changelog";
  readonly templatePayload: Omit<ChangelogTemplatePayload, "unsubscribe">;
  readonly topic: EmailSubscriptionTopic;
};

type PostNotificationContent = {
  readonly template: "subscription-notification";
  readonly templatePayload: Omit<NotificationTemplatePayload, "unsubscribe">;
  readonly topic: EmailSubscriptionTopic;
};

/**
 * Most posts one notification email lists before it links to the dashboard.
 *
 * A window may cover more than it stores (`submissionWindowMaxPosts`); the
 * email summarises the rest by count rather than rendering hundreds of rows.
 */
const submissionNotificationMaxListed = 20;

/**
 * A rendered submission notification plus the access proof it was rendered
 * under. The proof rides in the delivery's stored payload so the send-time gate
 * can see what the email names even after a post is gone; the template decoder
 * ignores it.
 */
export type SubmissionNotificationPayload = NotificationTemplatePayload & {
  readonly notifiedBoardVisibility: PostBoardVisibility | null;
  /** The posts the email names, oldest first — the gate's proof set. */
  readonly notifiedPostIds: readonly string[];
};

/**
 * Builds the immutable administrative submission-notification snapshot.
 *
 * The payload covers every post in the window, so the title carries the count
 * and the list is truncated with a link rather than one email per submission.
 */
export const makeSubmissionNotificationPayload = (
  appUrl: string,
  organizationId: string,
  posts: ReadonlyArray<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly board: {
      readonly slug: string;
      readonly visibility: PostBoardVisibility;
    } | null;
  }>,
  /**
   * Submissions the window covers. Larger than `posts.length` once a window
   * stored its id cap or lost a post to deletion, so the copy counts what
   * happened rather than what could still be rendered.
   */
  submissionCount: number
): SubmissionNotificationPayload => {
  const listed = posts.slice(0, submissionNotificationMaxListed);
  const remaining = submissionCount - listed.length;
  const isSingle = submissionCount === 1;

  return {
    actionLabel: "View dashboard",
    actionUrl: appUrl,
    // A single submission keeps the wording it had before windows existed; the
    // count only appears once a window actually coalesced two or more.
    body: isSingle
      ? "A new post has been submitted."
      : `${submissionCount} new posts have been submitted.`,
    eyebrow: "Feedback",
    posts: [
      ...listed.map((post) => ({
        label: post.title,
        url: `${appUrl}/${organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`,
      })),
      ...(remaining > 0
        ? [
            {
              label:
                remaining === 1
                  ? "and 1 more submitted post"
                  : `and ${remaining} more submitted posts`,
              url: appUrl,
            },
          ]
        : []),
    ],
    title: isSingle
      ? "New submission in your workspace"
      : `${submissionCount} new submissions in your workspace`,
    // Only the listed posts are named in the mail, so only they need proving —
    // their ids ride along so the send-time gate resolves current rows over the
    // named set rather than over the window's full stored list. An empty list
    // (a capped window whose tracked posts were all deleted) has nothing to
    // prove either way, which stays fail-closed for rule 3.
    notifiedPostIds: listed.map((post) => post.id),
    notifiedBoardVisibility:
      listed.length === 0
        ? null
        : listed.every((post) => post.board?.visibility === "PUBLIC")
          ? "PUBLIC"
          : "PRIVATE",
    unsubscribe: {
      // The preference is per workspace and per user, so the link names the
      // workspace whose settings page owns the toggle. The dashboard guard
      // treats it as an ordinary deep link and only canonicalizes paths that
      // do not already carry an organization id.
      kind: "settings",
      url: `${appUrl}/${organizationId}/settings/notifications`,
    },
  };
};

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split("_")
    .map((part) =>
      part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`
    )
    .join(" ");

/** Maps one intent kind to the exact consent topic checked before delivery. */
export const emailSubscriptionTopicForIntent = (
  payload: EmailIntentPayload
): EmailSubscriptionTopic | undefined => {
  switch (payload.kind) {
    case "changelog.published":
    case "changelog.update_requested":
      return { topicId: null, topicType: "changelog" };
    case "post.status_changed":
    case "post.official_update_published":
    case "post.closed":
      return { topicId: payload.postId, topicType: "post" };
    // The merge reassigns subscriptions to the surviving post, so the
    // notification is delivered on the target topic. Unmerging restores the
    // subscriptions to the source, so that one delivers on the source topic.
    case "post.merged":
      return { topicId: payload.targetPostId, topicType: "post" };
    case "post.unmerged":
      return { topicId: payload.postId, topicType: "post" };
    default:
      return undefined;
  }
};

/** Whether the workspace changelog may currently be delivered by email. */
export const isChangelogPubliclyVisible = (
  organizationId: string,
  changelogId?: string
) =>
  transaction(
    Effect.gen(function* () {
      const db = yield* Database.Database;
      const [site] = yield* db
        .select({
          changelogVisibility: schema.siteTable.changelogVisibility,
        })
        .from(schema.siteTable)
        .where(eq(schema.siteTable.organizationId, organizationId))
        .limit(1);
      if (!(site && site.changelogVisibility === "PUBLIC")) {
        return false;
      }
      // When the intent targets one entry, the entry itself must still be
      // published: an unpublish between intent recording and send must not
      // email subscribers a dead link.
      if (changelogId === undefined) {
        return true;
      }
      const [entry] = yield* db
        .select({ status: schema.changelogTable.status })
        .from(schema.changelogTable)
        .where(
          and(
            eq(schema.changelogTable.id, changelogId),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        )
        .limit(1);
      return entry?.status === "published";
    })
  );

const buildPublicSiteUrl = (
  site: { readonly subdomain: string; readonly customDomain: string | null },
  appRootDomain: string
): string => {
  if (site.customDomain) {
    const host = site.customDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    return `https://${host}`;
  }
  return `https://${site.subdomain}.${appRootDomain}`;
};

/** Resolves current product data into an immutable subscription-mail snapshot. */
export const resolveSubscriptionNotificationContent = (
  appUrl: string,
  intent: Pick<EmailOutboxRecord, "organizationId" | "payload">,
  appRootDomain: string = ""
) =>
  Effect.gen(function* () {
    switch (intent.payload.kind) {
      case "changelog.published":
      case "changelog.update_requested": {
        // All changelog reads use a single transaction so the site visibility,
        // changelog row, organization, and categories are snapshot-consistent.
        // The public URL must point at the public site (customDomain or
        // subdomain.${appRootDomain}), not the dashboard appUrl.
        const changelogId = intent.payload.changelogId;
        const changelogKind = intent.payload.kind;
        return yield* transaction(
          Effect.gen(function* () {
            const txDb = yield* Database.Database;
            const site = yield* txDb.query.siteTable.findFirst({
              where: { organizationId: intent.organizationId },
              columns: {
                changelogVisibility: true,
                customDomain: true,
                subdomain: true,
              },
            });
            if (!site || site.changelogVisibility !== "PUBLIC") {
              return undefined;
            }
            const changelog = yield* txDb.query.changelogTable.findFirst({
              where: {
                id: changelogId,
                organizationId: intent.organizationId,
                // Unpublishing (or a still-scheduled entry) closes delivery
                // for intents recorded before the transition.
                status: "published",
              },
              columns: {
                coverImage: true,
                excerpt: true,
                publishedAt: true,
                slug: true,
                title: true,
              },
            });
            if (!changelog) {
              return undefined;
            }
            const [organization, categories] = yield* Effect.all(
              [
                txDb.query.organizationTable.findFirst({
                  where: { id: intent.organizationId },
                  columns: { name: true },
                }),
                txDb
                  .select({ name: schema.changelogCategoryTable.name })
                  .from(schema.changelogCategoryLinkTable)
                  .innerJoin(
                    schema.changelogCategoryTable,
                    eq(
                      schema.changelogCategoryTable.id,
                      schema.changelogCategoryLinkTable.categoryId
                    )
                  )
                  .where(
                    eq(
                      schema.changelogCategoryLinkTable.changelogId,
                      changelogId
                    )
                  ),
              ],
              { concurrency: 2 }
            );
            const categoryNames = categories.map((row) => row.name);
            const published = changelogKind === "changelog.published";
            const publishedAtLabel = changelog.publishedAt
              ? new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  // Emails are sent outside any user context; format in UTC so
                  // the label is stable regardless of the server timezone.
                  timeZone: "UTC",
                }).format(changelog.publishedAt)
              : null;
            const effectiveRootDomain = appRootDomain || new URL(appUrl).host;
            const publicSiteUrl = buildPublicSiteUrl(site, effectiveRootDomain);
            return {
              template: "changelog" as const,
              topic: { topicType: "changelog" as const, topicId: null },
              templatePayload: {
                actionLabel: "View changelog",
                actionUrl: `${publicSiteUrl}/changelog/${changelog.slug}`,
                body:
                  changelog.excerpt ||
                  (published
                    ? "A new changelog entry has been published."
                    : "A changelog update is available."),
                ...(categoryNames.length > 0 && { categories: categoryNames }),
                ...(changelog.coverImage && {
                  coverImageUrl: changelog.coverImage,
                }),
                eyebrow: "Changelog",
                ...(organization?.name && {
                  organizationName: organization.name,
                }),
                ...(publishedAtLabel && { publishedAtLabel }),
                title: changelog.title,
              },
            } satisfies ChangelogNotificationContent;
          })
        );
      }
      case "post.status_changed":
      case "post.official_update_published":
      case "post.merged":
      case "post.unmerged":
      case "post.closed": {
        // Snapshot post reads transactionally as well.
        // SAFETY: every payload variant matching these five kind tags carries a postId.
        const postId = intent.payload.postId;
        const payloadKind = intent.payload.kind;
        const payloadBody =
          intent.payload.kind === "post.official_update_published"
            ? intent.payload.body
            : undefined;
        // A merge notification is about the source post but must land on the
        // surviving target: the source is archived and its public URL
        // redirects. An unmerge reverses that: the source is live again, so it
        // is the linked post while the survivor's title moves into the body.
        const urlPostId =
          intent.payload.kind === "post.merged"
            ? intent.payload.targetPostId
            : postId;
        // The other post the event names: the merged-away source for a merge,
        // the survivor for an unmerge. Both titles make the email readable
        // without opening either post.
        const counterpartPostId =
          intent.payload.kind === "post.merged"
            ? intent.payload.postId
            : intent.payload.kind === "post.unmerged"
              ? intent.payload.targetPostId
              : undefined;
        return yield* transaction(
          Effect.gen(function* () {
            const txDb = yield* Database.Database;
            const post = yield* txDb.query.postTable.findFirst({
              where: {
                id: urlPostId,
                organizationId: intent.organizationId,
              },
              columns: { slug: true, title: true },
              with: {
                board: { columns: { slug: true } },
                postStatus: { columns: { type: true } },
              },
            });
            if (!post) {
              return undefined;
            }
            const counterpart = counterpartPostId
              ? yield* txDb.query.postTable.findFirst({
                  where: {
                    id: counterpartPostId,
                    organizationId: intent.organizationId,
                  },
                  columns: { title: true },
                })
              : undefined;
            // The subject of a merge email is the source post that was
            // folded in, even though the link points at the target. For an
            // unmerge the linked post (the restored source) is the subject.
            const displayTitle =
              payloadKind === "post.merged"
                ? (counterpart?.title ?? post.title)
                : post.title;
            const counterpartTitle = counterpart?.title ?? "another post";
            const url = `${appUrl}/${intent.organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`;
            let event = `moved to ${titleCase(post.postStatus?.type ?? "updated")}`;
            if (payloadKind === "post.official_update_published") {
              event = "updated by the workspace team";
            } else if (payloadKind === "post.merged") {
              event = "merged";
            } else if (payloadKind === "post.unmerged") {
              event = "unmerged";
            } else if (payloadKind === "post.closed") {
              event = "closed";
            }
            return {
              template: "subscription-notification" as const,
              topic: {
                topicType: "post" as const,
                topicId: urlPostId,
              },
              templatePayload: {
                actionLabel: "View post",
                actionUrl: url,
                body:
                  payloadKind === "post.official_update_published" &&
                  payloadBody !== undefined
                    ? payloadBody
                    : payloadKind === "post.merged"
                      ? `"${displayTitle}" was merged into this post.`
                      : payloadKind === "post.unmerged"
                        ? `"${displayTitle}" was unmerged from "${counterpartTitle}".`
                        : `A post you follow was ${event}.`,
                eyebrow: "Feedback",
                posts: [{ label: displayTitle, url }],
                title: `Post ${event}: ${displayTitle}`,
              },
            } satisfies PostNotificationContent;
          })
        );
      }
      default:
        return undefined;
    }
  });
