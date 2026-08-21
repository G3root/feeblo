import { transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { InvalidSubjectError, SubjectNotFoundError } from "../identity/errors";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import {
  type PostActivityMetadata,
  PostActivityRepository,
} from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  InternalServerError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import {
  FailedToDeleteCommentError,
  FailedToUpdateCommentError,
} from "./errors";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type {
  TCommentCreate,
  TCommentDelete,
  TCommentList,
  TCommentUpdate,
} from "./schema";

export const CommentRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const activityRepository = yield* PostActivityRepository;
  const commentPolicy = yield* CommentPolicy;
  const resolvePrincipal = yield* ResolvePrincipalService;
  // const sitePolicy = yield* SitePolicy;

  const notifications = yield* Effect.serviceOption(NotificationService);

  // -- Shared effect helpers (no policy applied) --

  const createCommentEffect = (args: TCommentCreate) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      yield* transaction(
        Effect.gen(function* () {
          // On-behalf attribution resolves the customer inside the same
          // transaction as the mutation (see plan-on-behalf.md). Absent
          // `author`, everything below behaves exactly as before. Comments
          // need a user row, so shadow users are provisioned here for
          // email-only subjects. Identity failures surface as themselves;
          // infrastructure failures are normalized like every other
          // persistence error here.
          const subject =
            args.author === undefined
              ? undefined
              : yield* resolvePrincipal
                  .resolve({
                    organizationId: args.organizationId,
                    needsUser: true,
                    subject: args.author,
                  })
                  .pipe(
                    Effect.mapError(
                      (
                        error
                      ):
                        | SubjectNotFoundError
                        | InvalidSubjectError
                        | InternalServerError =>
                        error instanceof SubjectNotFoundError ||
                        error instanceof InvalidSubjectError
                          ? error
                          : new InternalServerError({
                              message: "Could not resolve the comment author.",
                            })
                    )
                  );
          // Comments need a user row: resolution with needsUser:true
          // guarantees one, provisioning a shadow account when necessary.
          if (subject !== undefined && subject.userId === null) {
            return yield* new InvalidSubjectError({
              message: "The resolved customer has no account to comment as",
            });
          }
          const authorUserId =
            subject === undefined || subject.userId === null
              ? session.session.userId
              : subject.userId;

          yield* repository.create({
            ...args,
            content: sanitizedMarkdown,
            userId: authorUserId,
            // On-behalf comments keep staff attribution out of the author fields.
            ...(membership &&
              !subject && { memberId: membership.membershipId }),
          });

          const onBehalfMetadata: PostActivityMetadata | undefined =
            subject && {
              onBehalfOf: {
                contactId: subject.contactId,
                ...(subject.userId !== null && { userId: subject.userId }),
              },
            };

          yield* activityRepository.create({
            organizationId: args.organizationId,
            postId: args.postId,
            actorId: session.session.userId,
            actorMemberId: membership?.membershipId ?? null,
            kind: "COMMENT_CREATED",
            commentId: args.id,
            visibility: args.visibility,
            ...(onBehalfMetadata && { metadata: onBehalfMetadata }),
          });

          // Ordinary comments — including on-behalf ones — record no email
          // intents and subscribe nobody; the in-app notification keeps its
          // member-only recipients with the staff member as actor.
          yield* Option.match(notifications, {
            onNone: () => Effect.void,
            onSome: (service) =>
              service.notifyComment({
                organizationId: args.organizationId,
                postId: args.postId,
                commentId: args.id,
                ...(membership && { actorMemberId: membership.membershipId }),
              }),
          });
        })
      );

      return {
        message: "Comment created successfully",
      };
    });
  };

  const deleteCommentEffect = (args: TCommentDelete) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      const deletedComment = yield* transaction(
        Effect.gen(function* () {
          const deleted = yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          });
          if (deleted) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_DELETED",
              commentId: args.id,
            });
          }
          return deleted;
        })
      );

      if (!deletedComment) {
        return yield* new FailedToDeleteCommentError({
          message: "Failed to delete comment",
        });
      }

      return {
        message: "Comment deleted successfully",
      };
    });

  const updateCommentEffect = (args: TCommentUpdate) => {
    const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
    return Effect.gen(function* () {
      const session = yield* CurrentSession;

      const membership = Policy.getMembership(session, args.organizationId);

      //only members can update visibility
      const updatedComment = yield* transaction(
        Effect.gen(function* () {
          const updated = yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: sanitizedMarkdown,
            userId: session.session.userId,
            ...(membership && { visibility: args.visibility }),
          });
          if (updated) {
            yield* activityRepository.create({
              organizationId: args.organizationId,
              postId: args.postId,
              actorId: session.session.userId,
              actorMemberId: membership?.membershipId ?? null,
              kind: "COMMENT_UPDATED",
              commentId: args.id,
              visibility: membership ? args.visibility : null,
            });
          }
          return updated;
        })
      );

      if (!updatedComment) {
        return yield* new FailedToUpdateCommentError({
          message: "Failed to update comment",
        });
      }

      return {
        message: "Comment updated successfully",
      };
    });
  };

  // -- RPC handlers --

  return {
    CommentList: (args: TCommentList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
          slug: args.slug,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Comment", "select")
        ),

    CommentListPublic: (args: TCommentList) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const isMember = Option.match(sessionOption, {
          onNone: () => false,
          onSome: (session) => Policy.isMember(session, args.organizationId),
        });
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const comments = yield* repository.findManyPublic({
          organizationId: args.organizationId,
          slug: args.slug,
          includeInternal: isMember,
        });

        // Never leak internal commenter identifiers to public callers.
        return redactActorIdentities(comments, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentListPublic",
          level: "read",
        }),
        withRemapDbErrors("Comment", "select")
      ),

    CommentCreate: (args: TCommentCreate) =>
      createCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            parentCommentId: args.parentCommentId,
            source: "dashboard",
            onBehalf: args.author !== undefined,
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentCreatePublic: (args: TCommentCreate) =>
      Effect.gen(function* () {
        if (args.author !== undefined) {
          return yield* new BadRequestError({
            message:
              "Comments cannot be created on behalf of another author from public boards",
          });
        }
        return yield* createCommentEffect(args);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentCreatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            parentCommentId: args.parentCommentId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentDelete: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canDelete({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "delete")
      ),

    CommentDeletePublic: (args: TCommentDelete) =>
      deleteCommentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentDeletePublic",
          level: "write",
        }),
        Policy.withPolicy(
          commentPolicy.canDelete({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "delete")
      ),

    CommentUpdate: (args: TCommentUpdate) =>
      updateCommentEffect(args).pipe(
        Policy.withPolicy(
          commentPolicy.canUpdate({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,

            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),

    CommentUpdatePublic: (args: TCommentUpdate) =>
      updateCommentEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentUpdatePublic",
          level: "expensive",
        }),
        Policy.withPolicy(
          commentPolicy.canUpdate({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),
  };
});

export const CommentRpcHandlers = CommentRpcs.toLayer(
  CommentRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(CommentPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(NotificationService.layer)
);
