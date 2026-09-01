import { Database, schema, transaction } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { EmailSubscriptionTopic } from "../email-subscription/schema";
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

/** Builds the immutable administrative submission-notification snapshot. */
export const makeSubmissionNotificationPayload = (
  appUrl: string,
  organizationId: string,
  post: {
    readonly slug: string;
    readonly title: string;
    readonly board: { readonly slug: string } | null;
  }
): NotificationTemplatePayload => ({
  actionLabel: "View dashboard",
  actionUrl: appUrl,
  body: "A new post has been submitted.",
  eyebrow: "Feedback",
  posts: [
    {
      label: post.title,
      url: `${appUrl}/${organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`,
    },
  ],
  title: "New submission in your workspace",
  unsubscribe: {
    kind: "settings",
    url: `${appUrl}/settings/notifications`,
  },
});

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
    case "post.merged":
    case "post.closed":
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
      case "post.closed": {
        // Snapshot post reads transactionally as well.
        // SAFETY: every payload variant matching these four kind tags carries a postId.
        const postId = intent.payload.postId;
        const payloadKind = intent.payload.kind;
        const payloadBody =
          intent.payload.kind === "post.official_update_published"
            ? intent.payload.body
            : undefined;
        return yield* transaction(
          Effect.gen(function* () {
            const txDb = yield* Database.Database;
            const post = yield* txDb.query.postTable.findFirst({
              where: {
                id: postId,
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
            const url = `${appUrl}/${intent.organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`;
            let event = `moved to ${titleCase(post.postStatus?.type ?? "updated")}`;
            if (payloadKind === "post.official_update_published") {
              event = "updated by the workspace team";
            } else if (payloadKind === "post.merged") {
              event = "merged";
            } else if (payloadKind === "post.closed") {
              event = "closed";
            }
            return {
              template: "subscription-notification" as const,
              topic: {
                topicType: "post" as const,
                topicId: postId,
              },
              templatePayload: {
                actionLabel: "View post",
                actionUrl: url,
                body:
                  payloadKind === "post.official_update_published" &&
                  payloadBody !== undefined
                    ? payloadBody
                    : `A post you follow was ${event}.`,
                eyebrow: "Feedback",
                posts: [{ label: post.title, url }],
                title: `Post ${event}: ${post.title}`,
              },
            } satisfies PostNotificationContent;
          })
        );
      }
      default:
        return undefined;
    }
  });
