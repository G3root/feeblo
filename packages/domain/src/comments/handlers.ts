import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EmailOutboxConfig } from "../email-outbox/config";
import { wakeEmailOutboxBestEffort } from "../email-outbox/queue";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import {
  type Surface,
  type SurfaceConfig,
  withSurfaceRateLimit,
} from "../surface";
import { CommentPolicy } from "./policies";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type {
  TCommentCreate,
  TCommentDelete,
  TCommentList,
  TCommentPin,
  TCommentUnpin,
  TCommentUpdate,
} from "./schema";
import { CommentService } from "./service";
import { applyCommentStatusUpdate } from "./status-update";

export const CommentRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentRepository;
  const commentPolicy = yield* CommentPolicy;
  // The writes themselves live in the shared service so the Public API's
  // comment endpoints land in the same timeline, notification, and transaction
  // machinery this surface uses. What stays here is the part only a member
  // session can decide: who is acting and whether they are allowed to.
  const comments = yield* CommentService;

  /** The session as the post timeline records it: the acting user and membership. */
  const actorOf = (
    session: CurrentSession["Service"],
    organizationId: string
  ) => ({
    memberId:
      Policy.getMembership(session, organizationId)?.membershipId ?? null,
    userId: session.session.userId,
  });

  // -- Surface-parameterized writes --
  //
  // The dashboard RPC and the public portal RPC are two names for one call.
  // Each write is implemented once and takes its surface; the surface's
  // policy and rate-limit level come from the `*Write` record, and the bucket
  // name is derived from the operation. The RPC names, their auth middleware,
  // and their error schemas stay separate in `./rpcs.ts`.

  const deleteWrite = {
    dashboard: {
      rateLimit: undefined,
      policy: (args: TCommentDelete) =>
        commentPolicy.canDelete({
          commentId: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          source: "dashboard",
        }),
    },
    public: {
      rateLimit: "write",
      policy: (args: TCommentDelete) =>
        commentPolicy.canDelete({
          commentId: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          source: "public",
        }),
    },
  } satisfies Record<Surface, SurfaceConfig<TCommentDelete>>;

  const updateWrite = {
    dashboard: {
      rateLimit: undefined,
      policy: (args: TCommentUpdate) =>
        commentPolicy.canUpdate({
          commentId: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          source: "dashboard",
        }),
    },
    public: {
      rateLimit: "expensive",
      policy: (args: TCommentUpdate) =>
        commentPolicy.canUpdate({
          commentId: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          source: "public",
        }),
    },
  } satisfies Record<Surface, SurfaceConfig<TCommentUpdate>>;

  const removeComment = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TCommentDelete
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      yield* comments.remove({
        actor: actorOf(session, args.organizationId),
        target: {
          id: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
        },
      });

      return {
        message: "Comment deleted successfully",
      };
    }).pipe(
      Policy.withPolicy(deleteWrite[surface].policy(args)),
      withRemapDbErrors("Comment", "delete"),
      withSurfaceRateLimit({ level, operation: "CommentDelete", surface })
    );

  const modifyComment = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TCommentUpdate
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, args.organizationId);

      yield* comments.update({
        actor: actorOf(session, args.organizationId),
        edit: {
          authorUserId: session.session.userId,
          content: args.content,
          id: args.id,
          organizationId: args.organizationId,
          postId: args.postId,
          // Only members can update visibility.
          visibility: membership ? args.visibility : undefined,
        },
      });

      return {
        message: "Comment updated successfully",
      };
    }).pipe(
      Policy.withPolicy(updateWrite[surface].policy(args)),
      withRemapDbErrors("Comment", "update"),
      withSurfaceRateLimit({ level, operation: "CommentUpdate", surface })
    );

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
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);

        if (args.author !== undefined) {
          // Per-member abuse bound for on-behalf creations (see
          // plan-on-behalf.md); self-service comments are unaffected.
          yield* RateLimit.consumeOnBehalfWriteLimit({
            organizationId: args.organizationId,
            userId: session.session.userId,
          });
        }

        const actor = actorOf(session, args.organizationId);

        const outboxId = yield* comments.create({
          actor,
          author:
            args.author === undefined
              ? {
                  kind: "self",
                  memberId: membership?.membershipId ?? null,
                  userId: session.session.userId,
                }
              : { kind: "on_behalf", subject: args.author },
          draft: {
            content: args.content,
            id: args.id,
            organizationId: args.organizationId,
            parentCommentId: args.parentCommentId,
            postId: args.postId,
            visibility: args.visibility,
          },
          statusUpdate: applyCommentStatusUpdate(args, actor),
        });
        // Post-commit wake for the status email intent the status-update
        // comment recorded; reconciliation closes any lost wake.
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);

        return {
          message: "Comment created successfully",
        };
      }).pipe(
        Policy.withPolicy(
          commentPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
            postId: args.postId,
            parentCommentId: args.parentCommentId,
            statusUpdateId: args.statusUpdateId,
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

        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const actor = actorOf(session, args.organizationId);

        yield* comments.create({
          actor,
          author: {
            kind: "self",
            memberId: membership?.membershipId ?? null,
            userId: session.session.userId,
          },
          draft: {
            content: args.content,
            id: args.id,
            organizationId: args.organizationId,
            parentCommentId: args.parentCommentId,
            postId: args.postId,
            visibility: args.visibility,
          },
          statusUpdate: applyCommentStatusUpdate(args, actor),
        });

        return {
          message: "Comment created successfully",
        };
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
            statusUpdateId: args.statusUpdateId,
            source: "public",
          })
        ),
        withRemapDbErrors("Comment", "create")
      ),

    CommentDelete: (args: TCommentDelete) =>
      removeComment("dashboard", deleteWrite.dashboard.rateLimit, args),

    CommentDeletePublic: (args: TCommentDelete) =>
      removeComment("public", deleteWrite.public.rateLimit, args),

    CommentUpdate: (args: TCommentUpdate) =>
      modifyComment("dashboard", updateWrite.dashboard.rateLimit, args),

    CommentUpdatePublic: (args: TCommentUpdate) =>
      modifyComment("public", updateWrite.public.rateLimit, args),

    CommentPin: (args: TCommentPin) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        yield* comments.pin({
          actor: actorOf(session, args.organizationId),
          target: {
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          },
        });

        return {
          message: "Comment pinned successfully",
        };
      }).pipe(
        Policy.withPolicy(
          commentPolicy.canPin({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Comment", "update")
      ),

    CommentUnpin: (args: TCommentUnpin) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        yield* comments.unpin({
          actor: actorOf(session, args.organizationId),
          target: {
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
          },
        });

        return {
          message: "Comment unpinned successfully",
        };
      }).pipe(
        Policy.withPolicy(
          commentPolicy.canPin({
            organizationId: args.organizationId,
            commentId: args.id,
            postId: args.postId,
            source: "dashboard",
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
  Layer.provide(CommentService.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(NotificationService.layer),
  Layer.provide(EmailOutboxConfig.layer)
);
