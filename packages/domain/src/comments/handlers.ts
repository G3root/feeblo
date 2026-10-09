import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailOutboxConfig } from "../email-outbox/config";
import { wakeEmailOutboxBestEffort } from "../email-outbox/queue";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import { withPublicViewer } from "../public-read";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import {
  type Surface,
  type SurfacePair,
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

/** The RPCs this group declares; a surface pair's operation must be one. */
type CommentRpcTag = RpcTagsOf<typeof CommentRpcs>;

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
    operation: "CommentDelete",
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
  } satisfies SurfacePair<TCommentDelete, CommentRpcTag>;

  const updateWrite = {
    operation: "CommentUpdate",
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
  } satisfies SurfacePair<TCommentUpdate, CommentRpcTag>;

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
      withSurfaceRateLimit({ level, operation: deleteWrite.operation, surface })
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
      withSurfaceRateLimit({ level, operation: updateWrite.operation, surface })
    );

  const createWrite = {
    operation: "CommentCreate",
    dashboard: {
      rateLimit: undefined,
      policy: (args: TCommentCreate) =>
        commentPolicy.canCreate({
          organizationId: args.organizationId,
          visibility: args.visibility,
          postId: args.postId,
          parentCommentId: args.parentCommentId,
          statusUpdateId: args.statusUpdateId,
          source: "dashboard",
          onBehalf: args.author !== undefined,
        }),
    },
    public: {
      rateLimit: "expensive",
      policy: (args: TCommentCreate) =>
        commentPolicy.canCreate({
          organizationId: args.organizationId,
          visibility: args.visibility,
          postId: args.postId,
          parentCommentId: args.parentCommentId,
          statusUpdateId: args.statusUpdateId,
          source: "public",
        }),
    },
  } satisfies SurfacePair<TCommentCreate, CommentRpcTag>;

  const addComment = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TCommentCreate
  ) =>
    Effect.gen(function* () {
      // On-behalf attribution is dashboard-only; the public portal names a
      // customer nowhere, so the payload cannot carry an author there.
      if (surface === "public" && args.author !== undefined) {
        return yield* new BadRequestError({
          message:
            "Comments cannot be created on behalf of another author from public boards",
        });
      }

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

      // Post-commit wake for the status email intent the status-update comment
      // recorded; reconciliation closes any lost wake. The public portal does
      // not record one.
      if (surface === "dashboard") {
        yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);
      }

      return {
        message: "Comment created successfully",
      };
    }).pipe(
      Policy.withPolicy(createWrite[surface].policy(args)),
      withRemapDbErrors("Comment", "create"),
      withSurfaceRateLimit({ level, operation: createWrite.operation, surface })
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
      withPublicViewer({
        read: (viewer) =>
          repository.findManyPublic({
            includeInternal: viewer.isMember(args.organizationId),
            organizationId: args.organizationId,
            slug: args.slug,
          }),
        redact: redactActorIdentities,
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentListPublic",
          level: "read",
        }),
        withRemapDbErrors("Comment", "select")
      ),

    CommentCreate: (args: TCommentCreate) =>
      addComment("dashboard", createWrite.dashboard.rateLimit, args),

    CommentCreatePublic: (args: TCommentCreate) =>
      addComment("public", createWrite.public.rateLimit, args),

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
