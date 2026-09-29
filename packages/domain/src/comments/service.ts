import { Database, schema, transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { InvalidSubjectError } from "../identity/errors";
import {
  resolveOnBehalfSubject,
  toOnBehalfMetadata,
} from "../identity/on-behalf";
import {
  ResolvePrincipalService,
  type OnBehalfSubject,
} from "../identity/service";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import {
  FailedToCreateCommentError,
  FailedToDeleteCommentError,
  FailedToPinCommentError,
  FailedToUnpinCommentError,
  FailedToUpdateCommentError,
  PostDoesNotAcceptCommentsError,
} from "./errors";
import { CommentRepository } from "./repository";

/**
 * The comment write path, shared by the dashboard RPC and the Public API.
 *
 * Both surfaces create, edit, delete, and pin the same rows and owe them the
 * same consequences: the sanitized body, the post-timeline entry, and the
 * notification fan-out. Keeping that here rather than in each handler is what
 * stops an API-created comment from being the one that never appears in a
 * post's history — the same reason `makeChangelogPublication` is shared with
 * the changelog surface.
 *
 * The caller owns authorization. This service assumes the actor may perform
 * the write and performs it; that is why the actor is an explicit argument
 * rather than a session read. The dashboard resolves one from `CurrentSession`
 * and a membership, the Public API passes the key's workspace with no user
 * behind it, and the two never have to agree on what a session is.
 */

/**
 * Who is performing the write, as the post timeline records it.
 *
 * Both ids are null when a machine credential acts: an API key is
 * organization-owned and is not a member. `post_activity` allows that and the
 * dashboard renders those entries as "Someone", which is true and better than
 * a comment that appears with no entry in the post's history at all.
 */
export type CommentActor = {
  readonly memberId: string | null;
  readonly userId: string | null;
};

/**
 * Whose name the comment carries.
 *
 * `self` is a member commenting as themselves. `on_behalf` attributes the
 * comment to the customer the subject resolves to, which is also the only way
 * a machine credential can author a comment: an API key has no user of its own,
 * so it always writes as the customer the request names.
 */
export type CommentAuthor =
  | {
      readonly kind: "self";
      readonly memberId: string | null;
      readonly userId: string;
    }
  | { readonly kind: "on_behalf"; readonly subject: OnBehalfSubject };

/** The fields a create writes. */
export type CommentDraft = {
  readonly content: string;
  readonly id: string;
  readonly organizationId: string;
  readonly parentCommentId: string | null;
  readonly postId: string;
  readonly visibility: "PUBLIC" | "INTERNAL";
};

/** The fields an edit replaces. */
export type CommentEdit = {
  readonly content: string;
  readonly id: string;
  readonly organizationId: string;
  readonly postId: string;
  /**
   * The comment's author. Present when the caller may only edit their own
   * comment — the dashboard and the portal both work that way — and absent
   * for a workspace credential, which may edit any comment in the workspace.
   */
  readonly authorUserId?: string | undefined;
  /** Omitted leaves the stored visibility alone. */
  readonly visibility: "PUBLIC" | "INTERNAL" | undefined;
};

/** A comment identified for a delete or a pin. */
export type CommentTarget = {
  readonly id: string;
  readonly organizationId: string;
  readonly postId: string;
};

/** The facts a reply's parent has to satisfy, on a create and on an edit. */
type ParentCheck = {
  readonly organizationId: string;
  readonly parentCommentId: string | null;
  readonly postId: string;
  readonly visibility: "PUBLIC" | "INTERNAL";
};

const makeCommentService = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const activityRepository = yield* PostActivityRepository;
  const notifications = yield* NotificationService;

  /**
   * The services the write methods read from the fiber context, captured at
   * construction so the methods carry no requirements of their own.
   *
   * That matters beyond tidiness: the Public API's handlers are handed to
   * `HttpApiBuilder`, which wraps a handler's requirements in a request the
   * route layer cannot satisfy — which is why that surface reads its services
   * from the context (`currentCommentService`) instead of declaring them. A
   * write still joins the caller's transaction: the database service is the
   * same handle the repositories hold, and the transaction connection is
   * fiber-local, not a service.
   */
  const database = yield* Database.Database;
  const crypto = yield* Crypto.Crypto;
  const resolvePrincipal = yield* ResolvePrincipalService;

  const provideInternals = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Database.Database, database),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(ResolvePrincipalService, resolvePrincipal)
    );

  /**
   * Resolves who the comment is attributed to.
   *
   * On-behalf resolution runs inside the caller's transaction (see
   * plan-on-behalf.md) so a shadow account cannot be provisioned for a write
   * that then rolls back. Comments need a user row, so a subject that resolves
   * to a contact with no account is rejected rather than silently attributed
   * to the actor.
   */
  const resolveAuthor = (author: CommentAuthor, organizationId: string) =>
    Effect.gen(function* () {
      if (author.kind === "self") {
        return {
          memberId: author.memberId,
          metadata: undefined,
          userId: author.userId,
        };
      }

      const subject = yield* resolveOnBehalfSubject({
        organizationId,
        needsUser: true,
        subject: author.subject,
        action: "comment author",
      });

      if (subject.userId === null) {
        return yield* new InvalidSubjectError({
          message: "The resolved customer has no account to comment as",
        });
      }

      return {
        // On-behalf comments keep staff attribution out of the author fields.
        memberId: null,
        metadata: toOnBehalfMetadata(subject),
        userId: subject.userId,
      };
    });

  /**
   * The post-state gate, re-checked inside the write's own transaction.
   *
   * The caller checks the state too, so an ordinary request is answered before
   * any of this work happens — but that check cannot hold the post still, and
   * a member can lock or merge it in between. This one takes the post row's
   * lock, so a concurrent lock or merge either commits first and is seen here,
   * or waits until the comment exists and then moves it with the post's other
   * comments. A post row that is gone by now is left to the insert's foreign
   * key, exactly as it was before this check existed.
   */
  const assertPostAcceptsComments = (draft: CommentDraft) =>
    Effect.gen(function* () {
      const rows = yield* database
        .select({
          lockedAt: schema.postTable.lockedAt,
          mergedIntoPostId: schema.postTable.mergedIntoPostId,
        })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, draft.postId),
            eq(schema.postTable.organizationId, draft.organizationId)
          )
        )
        .limit(1)
        // `no key update` rather than `update`: the post row is pointed at by
        // foreign keys across the workspace, and the stronger lock would block
        // unrelated inserts that merely reference this post.
        .for("no key update");

      const post = rows.at(0);
      if (post === undefined) {
        return;
      }

      if (post.lockedAt !== null) {
        return yield* new PostDoesNotAcceptCommentsError({
          message: "The post is locked and does not accept new comments.",
        });
      }

      if (post.mergedIntoPostId !== null) {
        return yield* new PostDoesNotAcceptCommentsError({
          message:
            "The post was merged into another post and does not accept new comments.",
        });
      }
    });

  /**
   * Rejects a parent that is not a comment on the same post and workspace.
   *
   * The composite check matters: `comment.parent_comment_id` is a plain
   * foreign key, so without this a reply could anchor to another workspace's
   * comment. The visibility rule is the one the dashboard policy also
   * enforces — an INTERNAL parent continues member-only context, so a PUBLIC
   * reply may not hang beneath it — and it is restated here because a machine
   * credential never passes through that policy.
   */
  const assertParentBelongsToPost = (parentCheck: ParentCheck) =>
    Effect.gen(function* () {
      if (parentCheck.parentCommentId === null) {
        return;
      }

      const parent = yield* repository.findById({
        id: parentCheck.parentCommentId,
        organizationId: parentCheck.organizationId,
        postId: parentCheck.postId,
      });

      if (Option.isNone(parent)) {
        return yield* new BadRequestError({
          message: "parentCommentId must name a comment on this post.",
        });
      }

      if (
        parent.value.visibility === "INTERNAL" &&
        parentCheck.visibility === "PUBLIC"
      ) {
        return yield* new BadRequestError({
          message: "A public reply cannot be placed under an internal comment.",
        });
      }
    });

  /**
   * Sanitizes a comment body and refuses one that sanitizes to nothing.
   *
   * The published schemas require a non-empty string, but only the sanitizer
   * knows what survives it: a body that is only whitespace, or only markup
   * that the sanitizer strips, becomes empty here. Storing it would answer a
   * successful write with a comment that renders as nothing.
   */
  const sanitizeCommentBody = (content: string) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(content);

    if (sanitizedMarkdown.trim().length === 0) {
      return Effect.fail(
        new BadRequestError({
          message: "A comment body must contain visible text.",
        })
      );
    }

    return Effect.succeed(sanitizedMarkdown);
  };

  /**
   * Re-applies the reply rule to a widening edit.
   *
   * A PUBLIC reply may not hang beneath an INTERNAL parent — the rule a create
   * enforces — and an edit that flips an INTERNAL reply to PUBLIC would
   * otherwise be a way around it. Only the change is checked: an edit that
   * carries the visibility the comment already has is not widening anything,
   * and refusing it would stop an author editing the body of a reply whose
   * parent was made INTERNAL after the fact. The comment is read for its own
   * parent, because an edit does not carry one, and a comment that is gone
   * fails the way a matching update that found no row does.
   */
  const assertVisibilityAllowedByParent = (edit: CommentEdit) =>
    Effect.gen(function* () {
      if (edit.visibility !== "PUBLIC") {
        return;
      }

      const existing = yield* repository.findById({
        id: edit.id,
        organizationId: edit.organizationId,
        postId: edit.postId,
      });

      if (Option.isNone(existing)) {
        return yield* new FailedToUpdateCommentError({
          message: "Failed to update comment",
        });
      }

      // Already public: the edit is not the change that would create the
      // forbidden state, so it is not this check's to refuse.
      if (existing.value.visibility === "PUBLIC") {
        return;
      }

      yield* assertParentBelongsToPost({
        organizationId: edit.organizationId,
        parentCommentId: existing.value.parentCommentId,
        postId: edit.postId,
        visibility: "PUBLIC",
      });
    });

  const create = <R = never>(args: {
    readonly actor: CommentActor;
    readonly author: CommentAuthor;
    readonly draft: CommentDraft;
    /**
     * The dashboard's status transition, run inside the create's transaction
     * when the request asked for one, and returning the id to store on the
     * comment. Absent for a machine key, which does not move a post's status
     * through a comment — see `status-update.ts` for why that effect lives
     * outside this service.
     */
    readonly statusUpdate?:
      | Effect.Effect<string | null, FailedToCreateCommentError, R>
      | undefined;
  }) =>
    Effect.gen(function* () {
      const sanitizedMarkdown = yield* sanitizeCommentBody(args.draft.content);

      yield* transaction(
        Effect.gen(function* () {
          yield* assertPostAcceptsComments(args.draft);

          const author = yield* resolveAuthor(
            args.author,
            args.draft.organizationId
          );

          yield* assertParentBelongsToPost(args.draft);

          const statusUpdateId =
            args.statusUpdate === undefined ? null : yield* args.statusUpdate;

          yield* repository.create({
            id: args.draft.id,
            organizationId: args.draft.organizationId,
            postId: args.draft.postId,
            content: sanitizedMarkdown,
            visibility: args.draft.visibility,
            parentCommentId: args.draft.parentCommentId,
            statusUpdateId,
            userId: author.userId,
            memberId: author.memberId ?? undefined,
          });

          yield* activityRepository.create({
            organizationId: args.draft.organizationId,
            postId: args.draft.postId,
            actorId: args.actor.userId,
            actorMemberId: args.actor.memberId,
            kind: "COMMENT_CREATED",
            commentId: args.draft.id,
            visibility: args.draft.visibility,
            ...(author.metadata && { metadata: author.metadata }),
          });

          // Ordinary comments — including on-behalf ones — record no email
          // intents and subscribe nobody; the in-app notification keeps its
          // member-only recipients with the acting member as actor.
          yield* notifications.notifyComment({
            organizationId: args.draft.organizationId,
            postId: args.draft.postId,
            commentId: args.draft.id,
            parentCommentId: args.draft.parentCommentId,
            visibility: args.draft.visibility,
            actorUserId: args.actor.userId,
          });
        })
      );
    }).pipe(
      // The service owns the driver-failure boundary for its writes: a raw
      // drizzle or legid error is an `InternalServerError` here, so the RPC
      // and the Public API answer a database fault the same way.
      withRemapDbErrors("Comment", "create"),
      provideInternals
    );

  const update = (args: {
    readonly actor: CommentActor;
    readonly edit: CommentEdit;
  }) =>
    Effect.gen(function* () {
      const sanitizedMarkdown = yield* sanitizeCommentBody(args.edit.content);

      const updatedComment = yield* transaction(
        Effect.gen(function* () {
          yield* assertVisibilityAllowedByParent(args.edit);

          const updated = yield* repository.update({
            id: args.edit.id,
            organizationId: args.edit.organizationId,
            postId: args.edit.postId,
            content: sanitizedMarkdown,
            ...(args.edit.authorUserId !== undefined && {
              userId: args.edit.authorUserId,
            }),
            ...(args.edit.visibility !== undefined && {
              visibility: args.edit.visibility,
            }),
          });
          if (Option.isSome(updated)) {
            yield* activityRepository.create({
              organizationId: args.edit.organizationId,
              postId: args.edit.postId,
              actorId: args.actor.userId,
              actorMemberId: args.actor.memberId,
              kind: "COMMENT_UPDATED",
              commentId: args.edit.id,
              visibility: args.edit.visibility ?? null,
            });
          }
          return updated;
        })
      );

      if (Option.isNone(updatedComment)) {
        return yield* new FailedToUpdateCommentError({
          message: "Failed to update comment",
        });
      }
    }).pipe(withRemapDbErrors("Comment", "update"), provideInternals);

  const remove = (args: {
    readonly actor: CommentActor;
    readonly target: CommentTarget;
  }) =>
    Effect.gen(function* () {
      const deletedComment = yield* transaction(
        Effect.gen(function* () {
          const deleted = yield* repository.delete({
            id: args.target.id,
            organizationId: args.target.organizationId,
            postId: args.target.postId,
          });
          if (Option.isSome(deleted)) {
            yield* activityRepository.create({
              organizationId: args.target.organizationId,
              postId: args.target.postId,
              actorId: args.actor.userId,
              actorMemberId: args.actor.memberId,
              kind: "COMMENT_DELETED",
              commentId: args.target.id,
            });
          }
          return deleted;
        })
      );

      if (Option.isNone(deletedComment)) {
        return yield* new FailedToDeleteCommentError({
          message: "Failed to delete comment",
        });
      }
    }).pipe(withRemapDbErrors("Comment", "delete"), provideInternals);

  const pin = (args: {
    readonly actor: CommentActor;
    readonly target: CommentTarget;
  }) =>
    Effect.gen(function* () {
      const pinned = yield* transaction(
        Effect.gen(function* () {
          const result = yield* repository.pin({
            id: args.target.id,
            organizationId: args.target.organizationId,
            postId: args.target.postId,
          });
          if (Option.isSome(result)) {
            yield* activityRepository.create({
              organizationId: args.target.organizationId,
              postId: args.target.postId,
              actorId: args.actor.userId,
              actorMemberId: args.actor.memberId,
              kind: "COMMENT_PINNED",
              commentId: args.target.id,
            });
          }
          return result;
        })
      );

      if (Option.isNone(pinned)) {
        return yield* new FailedToPinCommentError({
          message: "Failed to pin comment",
        });
      }
    }).pipe(withRemapDbErrors("Comment", "update"), provideInternals);

  const unpin = (args: {
    readonly actor: CommentActor;
    readonly target: CommentTarget;
  }) =>
    Effect.gen(function* () {
      const unpinned = yield* transaction(
        Effect.gen(function* () {
          const result = yield* repository.unpin({
            id: args.target.id,
            organizationId: args.target.organizationId,
            postId: args.target.postId,
          });
          if (Option.isSome(result)) {
            yield* activityRepository.create({
              organizationId: args.target.organizationId,
              postId: args.target.postId,
              actorId: args.actor.userId,
              actorMemberId: args.actor.memberId,
              kind: "COMMENT_UNPINNED",
              commentId: args.target.id,
            });
          }
          return result;
        })
      );

      if (Option.isNone(unpinned)) {
        return yield* new FailedToUnpinCommentError({
          message: "Failed to unpin comment",
        });
      }
    }).pipe(withRemapDbErrors("Comment", "update"), provideInternals);

  return { create, pin, remove, unpin, update };
});

export class CommentService extends Context.Service<CommentService>()(
  "CommentService",
  {
    make: makeCommentService,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the service from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through
 * the route layer, so the Public API's handlers take it from the context the
 * composition provides — the same shape as `currentPublicApiRepository`.
 */
export const currentCommentService = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, CommentService))
);
