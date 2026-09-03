import { currentDb, schema } from "@feeblo/db";
import type { TNotificationEventType } from "@feeblo/db/validation-schema/notification-kind";
import { NotificationId } from "@feeblo/id";
import { isString } from "@feeblo/utils/runtime-kind";
import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type NotificationInput = {
  actorUserId?: string | null;
  body?: string | null;
  deduplicationKey: string;
  href: string;
  kind: TNotificationEventType;
  organizationId: string;
  recipientUserIds: ReadonlyArray<string | null | undefined>;
  resourceId: string;
  resourceType: string;
  title: string;
};

type PostNotificationInput = {
  actorUserId?: string | null;
  organizationId: string;
  postId: string;
};

const makeNotificationService = Effect.gen(function* () {
  const db = yield* currentDb;

  const create = (input: NotificationInput) =>
    Effect.gen(function* () {
      const recipients = [...new Set(input.recipientUserIds)].filter(
        (userId): userId is string =>
          isString(userId) && userId !== input.actorUserId
      );

      yield* Effect.forEach(recipients, (recipientUserId) =>
        Effect.gen(function* () {
          const id = yield* NotificationId.generate;
          yield* db
            .insert(schema.notificationTable)
            .values({
              id,
              organizationId: input.organizationId,
              recipientUserId,
              actorUserId: input.actorUserId ?? null,
              kind: input.kind,
              resourceType: input.resourceType,
              resourceId: input.resourceId,
              title: input.title,
              body: input.body ?? null,
              href: input.href,
              deduplicationKey: input.deduplicationKey,
            })
            .onConflictDoNothing()
            .pipe(Effect.asVoid);
        })
      );
    });

  /**
   * Fan-out to every changelog subscriber, split by dashboard access:
   * members land on the dashboard edit page, while non-member subscribers
   * and members restricted to the workspace via SSO (who cannot open the
   * dashboard) are sent to the public changelog.
   */
  const notifyChangelogSubscribers = (input: {
    readonly actorUserId?: string | null;
    readonly changelogId: string;
    readonly changelogSlug: string;
    readonly deduplicationKey: string;
    readonly kind: "changelog.published" | "changelog.updated";
    readonly notificationTitle: string;
    readonly organizationId: string;
    readonly title: string;
  }) =>
    Effect.gen(function* () {
      const subscribers = yield* db
        .select({ userId: schema.changelogSubscriptionTable.userId })
        .from(schema.changelogSubscriptionTable)
        .where(
          eq(
            schema.changelogSubscriptionTable.organizationId,
            input.organizationId
          )
        );

      const members = yield* db
        .select({
          userId: schema.memberTable.userId,
          restrictedToOrganizationId:
            schema.userTable.restrictedToOrganizationId,
        })
        .from(schema.memberTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.memberTable.userId)
        )
        .where(eq(schema.memberTable.organizationId, input.organizationId));
      const memberUserIds = new Set(members.map((member) => member.userId));
      const restrictedUserIds = new Set(
        members
          .filter((member) => member.restrictedToOrganizationId !== null)
          .map((member) => member.userId)
      );
      const subscriberUserIds = subscribers.map(
        (subscriber) => subscriber.userId
      );
      const memberRecipients = subscriberUserIds.filter(
        (userId) => memberUserIds.has(userId) && !restrictedUserIds.has(userId)
      );
      const publicRecipients = subscriberUserIds.filter(
        (userId) => !memberUserIds.has(userId) || restrictedUserIds.has(userId)
      );

      yield* Effect.all([
        create({
          ...(input.actorUserId === undefined
            ? undefined
            : { actorUserId: input.actorUserId }),
          organizationId: input.organizationId,
          recipientUserIds: memberRecipients,
          kind: input.kind,
          resourceType: "changelog",
          resourceId: input.changelogId,
          title: input.notificationTitle,
          body: input.title,
          href: `/${input.organizationId}/changelog/edit/${input.changelogSlug}`,
          deduplicationKey: input.deduplicationKey,
        }),
        create({
          ...(input.actorUserId === undefined
            ? undefined
            : { actorUserId: input.actorUserId }),
          organizationId: input.organizationId,
          recipientUserIds: publicRecipients,
          kind: input.kind,
          resourceType: "changelog",
          resourceId: input.changelogId,
          title: input.notificationTitle,
          body: input.title,
          href: `/changelog/${input.changelogSlug}`,
          deduplicationKey: input.deduplicationKey,
        }),
      ]).pipe(Effect.asVoid);
    });

  const getPostContext = ({ organizationId, postId }: PostNotificationInput) =>
    db
      .select({
        title: schema.postTable.title,
        slug: schema.postTable.slug,
        creatorId: schema.postTable.creatorId,
        boardSlug: schema.boardTable.slug,
      })
      .from(schema.postTable)
      .innerJoin(
        schema.boardTable,
        eq(schema.boardTable.id, schema.postTable.boardId)
      )
      .where(
        and(
          eq(schema.postTable.id, postId),
          eq(schema.postTable.organizationId, organizationId)
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]));

  return {
    notifySubmission: ({
      actorUserId,
      organizationId,
      postId,
    }: PostNotificationInput) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const recipients = yield* db
          .select({ userId: schema.memberTable.userId })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              or(
                eq(schema.memberTable.role, "owner"),
                eq(schema.memberTable.role, "admin")
              )
            )
          );
        yield* create({
          ...(actorUserId === undefined ? undefined : { actorUserId }),
          organizationId,
          recipientUserIds: recipients.map((member) => member.userId),
          kind: "feedback.submitted",
          resourceType: "post",
          resourceId: postId,
          title: "New feedback submission",
          body: context.title,
          href: `/${organizationId}/post/${context.boardSlug}/${context.slug}`,
          deduplicationKey: `feedback.submitted:${postId}`,
        });
      }),

    notifyComment: ({
      actorUserId,
      organizationId,
      postId,
      commentId,
      parentCommentId = null,
      visibility,
    }: PostNotificationInput & {
      commentId: string;
      /** Set when the comment is a reply; the parent's author is notified. */
      parentCommentId?: string | null;
      visibility: "PUBLIC" | "INTERNAL";
    }) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const subscribers = yield* db
          .select({ userId: schema.postSubscriptionTable.userId })
          .from(schema.postSubscriptionTable)
          .where(
            and(
              eq(schema.postSubscriptionTable.organizationId, organizationId),
              eq(schema.postSubscriptionTable.postId, postId)
            )
          );
        // A reply also notifies the author of the comment being replied to;
        // create() drops the actor and dedupes, so self-replies stay silent.
        const parentAuthors =
          parentCommentId == null
            ? []
            : yield* db
                .select({ userId: schema.commentTable.userId })
                .from(schema.commentTable)
                .where(
                  and(
                    eq(schema.commentTable.id, parentCommentId),
                    eq(schema.commentTable.organizationId, organizationId),
                    eq(schema.commentTable.postId, postId)
                  )
                );
        // An INTERNAL comment is visible to members only, so non-members
        // (post creator, parent author, or subscribers who never joined)
        // must not be notified; PUBLIC comments keep the existing fan-out.
        const parentAuthorUserIds = parentAuthors.map(
          (parent) => parent.userId
        );
        const subscriberUserIds = subscribers.map(
          (subscriber) => subscriber.userId
        );
        let recipientUserIds: ReadonlyArray<string | null | undefined> = [
          context.creatorId,
          ...parentAuthorUserIds,
          ...subscriberUserIds,
        ];
        if (visibility === "INTERNAL") {
          const candidateUserIds = [
            ...new Set(
              recipientUserIds.filter((userId): userId is string =>
                isString(userId)
              )
            ),
          ];
          if (candidateUserIds.length > 0) {
            const memberRecipients = yield* db
              .select({ userId: schema.memberTable.userId })
              .from(schema.memberTable)
              .where(
                and(
                  eq(schema.memberTable.organizationId, organizationId),
                  inArray(schema.memberTable.userId, candidateUserIds)
                )
              );
            const memberUserIds = new Set(
              memberRecipients.map((member) => member.userId)
            );
            recipientUserIds = candidateUserIds.filter((userId) =>
              memberUserIds.has(userId)
            );
          } else {
            recipientUserIds = [];
          }
        }
        yield* create({
          ...(actorUserId === undefined ? undefined : { actorUserId }),
          organizationId,
          recipientUserIds,
          kind: "feedback.commented",
          resourceType: "comment",
          resourceId: commentId,
          title: "New comment on feedback",
          body: context.title,
          href: `/${organizationId}/post/${context.boardSlug}/${context.slug}#comment-${commentId}`,
          deduplicationKey: `feedback.commented:${commentId}`,
        });
      }),

    notifyPostStatusChanged: ({
      actorUserId,
      organizationId,
      postId,
    }: PostNotificationInput) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const subscribers = yield* db
          .select({ userId: schema.postSubscriptionTable.userId })
          .from(schema.postSubscriptionTable)
          .where(
            and(
              eq(schema.postSubscriptionTable.organizationId, organizationId),
              eq(schema.postSubscriptionTable.postId, postId)
            )
          );
        const crypto = yield* Crypto.Crypto;
        const statusChangedUuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
        yield* create({
          ...(actorUserId === undefined ? undefined : { actorUserId }),
          organizationId,
          recipientUserIds: [
            context.creatorId,
            ...subscribers.map((subscriber) => subscriber.userId),
          ],
          kind: "feedback.status_changed",
          resourceType: "post",
          resourceId: postId,
          title: "Feedback status updated",
          body: context.title,
          href: `/${organizationId}/post/${context.boardSlug}/${context.slug}`,
          deduplicationKey: `feedback.status_changed:${postId}:${statusChangedUuid}`,
        });
      }),

    /**
     * Notifies every user subscribed to the workspace changelog, member or
     * not. Recipients come straight from `changelog_subscription` (user ids
     * scoped by organization), so no membership is required to be notified.
     */
    notifyChangelogPublished: ({
      actorUserId,
      changelogId,
      changelogSlug,
      organizationId,
      title,
    }: {
      readonly actorUserId?: string | null;
      readonly changelogId: string;
      readonly changelogSlug: string;
      readonly organizationId: string;
      readonly title: string;
    }) =>
      notifyChangelogSubscribers({
        ...(actorUserId === undefined ? undefined : { actorUserId }),
        changelogId,
        changelogSlug,
        deduplicationKey: `changelog.published:${changelogId}`,
        kind: "changelog.published",
        notificationTitle: "New changelog entry",
        organizationId,
        title,
      }),

    /**
     * Same fan-out as a publish, for "send update" on an already-published
     * entry. Deduplicated per send-update request so retries stay silent.
     */
    notifyChangelogUpdated: ({
      actorUserId,
      changelogId,
      changelogSlug,
      organizationId,
      requestId,
      title,
    }: {
      readonly actorUserId?: string | null;
      readonly changelogId: string;
      readonly changelogSlug: string;
      readonly organizationId: string;
      readonly requestId: string;
      readonly title: string;
    }) =>
      notifyChangelogSubscribers({
        ...(actorUserId === undefined ? undefined : { actorUserId }),
        changelogId,
        changelogSlug,
        deduplicationKey: `changelog.updated:${changelogId}:${requestId}`,
        kind: "changelog.updated",
        notificationTitle: "Changelog update sent",
        organizationId,
        title,
      }),

    /** Notifies only members who upvoted a post; upvoting intentionally does not imply subscription. */
    notifyPostStatusChangedUpvoters: ({
      actorUserId,
      organizationId,
      postId,
      deduplicationKey,
    }: PostNotificationInput & { readonly deduplicationKey: string }) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const upvoters = yield* db
          .select({ userId: schema.upvoteTable.userId })
          .from(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.organizationId, organizationId),
              eq(schema.upvoteTable.postId, postId)
            )
          );
        yield* create({
          ...(actorUserId === undefined ? undefined : { actorUserId }),
          organizationId,
          recipientUserIds: upvoters.map((upvoter) => upvoter.userId),
          kind: "feedback.status_changed",
          resourceType: "post",
          resourceId: postId,
          title: "Feedback status updated",
          body: context.title,
          href: `/${organizationId}/post/${context.boardSlug}/${context.slug}`,
          deduplicationKey,
        });
      }),

    list: ({
      organizationId,
      recipientUserId,
      cursor,
      limit = 20,
    }: {
      cursor?: Date;
      limit?: number;
      organizationId: string;
      recipientUserId: string;
    }) =>
      db
        .select({
          id: schema.notificationTable.id,
          organizationId: schema.notificationTable.organizationId,
          recipientUserId: schema.notificationTable.recipientUserId,
          actorUserId: schema.notificationTable.actorUserId,
          kind: schema.notificationTable.kind,
          resourceType: schema.notificationTable.resourceType,
          resourceId: schema.notificationTable.resourceId,
          title: schema.notificationTable.title,
          body: schema.notificationTable.body,
          href: schema.notificationTable.href,
          readAt: schema.notificationTable.readAt,
          createdAt: schema.notificationTable.createdAt,
        })
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.organizationId, organizationId),
            eq(schema.notificationTable.recipientUserId, recipientUserId),
            ...(cursor ? [lt(schema.notificationTable.createdAt, cursor)] : [])
          )
        )
        .orderBy(desc(schema.notificationTable.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50)),

    unreadCount: ({
      organizationId,
      recipientUserId,
    }: {
      organizationId: string;
      recipientUserId: string;
    }) =>
      db
        .select({ count: count() })
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.organizationId, organizationId),
            eq(schema.notificationTable.recipientUserId, recipientUserId),
            isNull(schema.notificationTable.readAt)
          )
        )
        .pipe(Effect.map((rows) => rows[0]?.count ?? 0)),

    markRead: ({
      id,
      organizationId,
      recipientUserId,
    }: {
      id: string;
      organizationId: string;
      recipientUserId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.notificationTable)
          .set({ readAt: now })
          .where(
            and(
              eq(schema.notificationTable.id, id),
              eq(schema.notificationTable.organizationId, organizationId),
              eq(schema.notificationTable.recipientUserId, recipientUserId)
            )
          );
      }),

    markAllRead: ({
      organizationId,
      recipientUserId,
    }: {
      organizationId: string;
      recipientUserId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.notificationTable)
          .set({ readAt: now })
          .where(
            and(
              eq(schema.notificationTable.organizationId, organizationId),
              eq(schema.notificationTable.recipientUserId, recipientUserId),
              isNull(schema.notificationTable.readAt)
            )
          );
      }),
  };
});

export class NotificationService extends Context.Service<NotificationService>()(
  "NotificationService",
  { make: makeNotificationService }
) {
  static readonly layer = Layer.effect(this, this.make);
}
