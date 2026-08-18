import { Database } from "@feeblo/db";
import * as Effect from "effect/Effect";

import type { EmailSubscriptionTopic } from "../email-subscription/schema";
import type {
  EmailIntentPayload,
  EmailOutboxRecord,
  NotificationTemplatePayload,
} from "./schema";

export type EmailNotificationContent = {
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

/** Resolves current product data into an immutable subscription-mail snapshot. */
export const resolveSubscriptionNotificationContent = (
  appUrl: string,
  intent: Pick<EmailOutboxRecord, "organizationId" | "payload">
) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    switch (intent.payload.kind) {
      case "changelog.published":
      case "changelog.update_requested": {
        const changelog = yield* db.query.changelogTable.findFirst({
          where: {
            id: intent.payload.changelogId,
            organizationId: intent.organizationId,
          },
          columns: { excerpt: true, slug: true, title: true },
        });
        if (!changelog) {
          return undefined;
        }
        const published = intent.payload.kind === "changelog.published";
        return {
          topic: { topicType: "changelog" as const, topicId: null },
          templatePayload: {
            actionLabel: "View changelog",
            actionUrl: `${appUrl}/${intent.organizationId}/changelog`,
            body:
              changelog.excerpt ||
              (published
                ? "A new changelog entry has been published."
                : "A changelog update is available."),
            eyebrow: "Changelog",
            posts: [
              {
                label: changelog.title,
                url: `${appUrl}/${intent.organizationId}/changelog`,
              },
            ],
            title: `${published ? "New changelog" : "Changelog update"}: ${changelog.title}`,
          },
        } satisfies EmailNotificationContent;
      }
      case "post.status_changed":
      case "post.official_update_published":
      case "post.merged":
      case "post.closed": {
        const post = yield* db.query.postTable.findFirst({
          where: {
            id: intent.payload.postId,
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
        if (intent.payload.kind === "post.official_update_published") {
          event = "updated by the workspace team";
        } else if (intent.payload.kind === "post.merged") {
          event = "merged";
        } else if (intent.payload.kind === "post.closed") {
          event = "closed";
        }
        return {
          topic: { topicType: "post" as const, topicId: intent.payload.postId },
          templatePayload: {
            actionLabel: "View post",
            actionUrl: url,
            body:
              intent.payload.kind === "post.official_update_published"
                ? intent.payload.body
                : `A post you follow was ${event}.`,
            eyebrow: "Feedback",
            posts: [{ label: post.title, url }],
            title: `Post ${event}: ${post.title}`,
          },
        } satisfies EmailNotificationContent;
      }
      default:
        return undefined;
    }
  });
