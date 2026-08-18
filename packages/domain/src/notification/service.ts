import { currentDb, schema } from "@feeblo/db";
import type { TNotificationEventType } from "@feeblo/db/validation-schema/notification-kind";
import { NotificationId } from "@feeblo/id";
import { isString } from "@feeblo/utils/runtime-kind";
import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type NotificationInput = {
  actorMemberId?: string | null;
  body?: string | null;
  deduplicationKey: string;
  href: string;
  kind: TNotificationEventType;
  organizationId: string;
  recipientMemberIds: ReadonlyArray<string | null | undefined>;
  resourceId: string;
  resourceType: string;
  title: string;
};

type PostNotificationInput = {
  actorMemberId?: string | null;
  organizationId: string;
  postId: string;
};

const makeNotificationService = Effect.gen(function* () {
  const db = yield* currentDb;

  const create = (input: NotificationInput) =>
    Effect.gen(function* () {
      const recipients = [...new Set(input.recipientMemberIds)].filter(
        (memberId): memberId is string =>
          isString(memberId) && memberId !== input.actorMemberId
      );

      yield* Effect.forEach(recipients, (recipientMemberId) =>
        Effect.gen(function* () {
          const id = yield* NotificationId.generate;
          yield* db
            .insert(schema.notificationTable)
            .values({
              id,
              organizationId: input.organizationId,
              recipientMemberId,
              actorMemberId: input.actorMemberId ?? null,
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

  const getPostContext = ({ organizationId, postId }: PostNotificationInput) =>
    db
      .select({
        title: schema.postTable.title,
        slug: schema.postTable.slug,
        creatorMemberId: schema.postTable.creatorMemberId,
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
      actorMemberId,
      organizationId,
      postId,
    }: PostNotificationInput) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const recipients = yield* db
          .select({ id: schema.memberTable.id })
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
          ...(actorMemberId === undefined ? undefined : { actorMemberId }),
          organizationId,
          recipientMemberIds: recipients.map((member) => member.id),
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
      actorMemberId,
      organizationId,
      postId,
      commentId,
    }: PostNotificationInput & { commentId: string }) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const subscribers = yield* db
          .select({ memberId: schema.postSubscriptionTable.memberId })
          .from(schema.postSubscriptionTable)
          .where(
            and(
              eq(schema.postSubscriptionTable.organizationId, organizationId),
              eq(schema.postSubscriptionTable.postId, postId)
            )
          );
        yield* create({
          ...(actorMemberId === undefined ? undefined : { actorMemberId }),
          organizationId,
          recipientMemberIds: [
            context.creatorMemberId,
            ...subscribers.map((subscriber) => subscriber.memberId),
          ],
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
      actorMemberId,
      organizationId,
      postId,
    }: PostNotificationInput) =>
      Effect.gen(function* () {
        const context = yield* getPostContext({ organizationId, postId });
        if (!context) {
          return;
        }
        const subscribers = yield* db
          .select({ memberId: schema.postSubscriptionTable.memberId })
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
          ...(actorMemberId === undefined ? undefined : { actorMemberId }),
          organizationId,
          recipientMemberIds: [
            context.creatorMemberId,
            ...subscribers.map((subscriber) => subscriber.memberId),
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

    /** Notifies only members who upvoted a post; upvoting intentionally does not imply subscription. */
    notifyPostStatusChangedUpvoters: ({
      actorMemberId,
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
          .select({ memberId: schema.upvoteTable.memberId })
          .from(schema.upvoteTable)
          .where(
            and(
              eq(schema.upvoteTable.organizationId, organizationId),
              eq(schema.upvoteTable.postId, postId)
            )
          );
        yield* create({
          ...(actorMemberId === undefined ? undefined : { actorMemberId }),
          organizationId,
          recipientMemberIds: upvoters.map((upvoter) => upvoter.memberId),
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
      recipientMemberId,
      cursor,
      limit = 20,
    }: {
      cursor?: Date;
      limit?: number;
      organizationId: string;
      recipientMemberId: string;
    }) =>
      db
        .select({
          id: schema.notificationTable.id,
          organizationId: schema.notificationTable.organizationId,
          recipientMemberId: schema.notificationTable.recipientMemberId,
          actorMemberId: schema.notificationTable.actorMemberId,
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
            eq(schema.notificationTable.recipientMemberId, recipientMemberId),
            ...(cursor ? [lt(schema.notificationTable.createdAt, cursor)] : [])
          )
        )
        .orderBy(desc(schema.notificationTable.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50)),

    unreadCount: ({
      organizationId,
      recipientMemberId,
    }: {
      organizationId: string;
      recipientMemberId: string;
    }) =>
      db
        .select({ count: count() })
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.organizationId, organizationId),
            eq(schema.notificationTable.recipientMemberId, recipientMemberId),
            isNull(schema.notificationTable.readAt)
          )
        )
        .pipe(Effect.map((rows) => rows[0]?.count ?? 0)),

    markRead: ({
      id,
      organizationId,
      recipientMemberId,
    }: {
      id: string;
      organizationId: string;
      recipientMemberId: string;
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
              eq(schema.notificationTable.recipientMemberId, recipientMemberId)
            )
          );
      }),

    markAllRead: ({
      organizationId,
      recipientMemberId,
    }: {
      organizationId: string;
      recipientMemberId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.notificationTable)
          .set({ readAt: now })
          .where(
            and(
              eq(schema.notificationTable.organizationId, organizationId),
              eq(schema.notificationTable.recipientMemberId, recipientMemberId),
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
