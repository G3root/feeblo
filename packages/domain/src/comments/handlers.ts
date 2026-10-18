import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailOutboxConfig } from "../email-outbox/config";
import { wakeEmailOutboxBestEffort } from "../email-outbox/queue";
import { EntitlementPolicy } from "../entitlement/policies";
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
import { type Surface, definePublicEntry, defineSurfacePair } from "../surface";
import { WorkspaceRepository } from "../workspace/repository";
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
  const entitlementPolicy = yield* EntitlementPolicy;
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
  // Each write is implemented once as a pair's `handlers` body; the policy,
  // the rate-limit level, and the db-error remap come from the pair, and the
  // bucket name is derived from the operation. The RPC names, their auth
  // middleware, and their error schemas stay separate in `./rpcs.ts`.

  // One factory per admission rule the surfaces share: each entry passes its
  // own surface to it, so the policy's `source` is the surface the entry
  // actually answers and the halves cannot disagree.
  const canDeleteFor = (args: TCommentDelete, surface: Surface) =>
    commentPolicy.canDelete({
      commentId: args.id,
      organizationId: args.organizationId,
      postId: args.postId,
      source: surface,
    });

  const canUpdateFor = (args: TCommentUpdate, surface: Surface) =>
    commentPolicy.canUpdate({
      commentId: args.id,
      organizationId: args.organizationId,
      postId: args.postId,
      source: surface,
    });

  // On-behalf attribution is a dashboard capability; the public `canCreate`
  // branch never consults `onBehalf`, and the body below refuses an author
  // outright on the portal, so one factory serves both halves.
  const canCreateFor = (args: TCommentCreate, surface: Surface) =>
    commentPolicy.canCreate({
      organizationId: args.organizationId,
      visibility: args.visibility,
      postId: args.postId,
      parentCommentId: args.parentCommentId,
      statusUpdateId: args.statusUpdateId,
      source: surface,
      onBehalf: args.author !== undefined,
    });

  const deleteWrite = defineSurfacePair<TCommentDelete, CommentRpcTag>()({
    operation: "DeleteComment",
    remap: { action: "delete", entity: "Comment" },
    dashboard: { rateLimit: undefined, policy: canDeleteFor },
    public: { rateLimit: "write", policy: canDeleteFor },
  });

  const updateWrite = defineSurfacePair<TCommentUpdate, CommentRpcTag>()({
    operation: "UpdateComment",
    remap: { action: "update", entity: "Comment" },
    dashboard: { rateLimit: undefined, policy: canUpdateFor },
    public: { rateLimit: "expensive", policy: canUpdateFor },
  });

  const removeComment = deleteWrite.handlers((_surface, args) =>
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
    })
  );

  const modifyComment = updateWrite.handlers((_surface, args) =>
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
    })
  );

  const createWrite = defineSurfacePair<TCommentCreate, CommentRpcTag>()({
    operation: "CreateComment",
    remap: { action: "create", entity: "Comment" },
    dashboard: { rateLimit: undefined, policy: canCreateFor },
    public: { rateLimit: "expensive", policy: canCreateFor },
  });

  // The dashboard list projects with `isMember` visibility shared with the
  // viewer's own rows; the public list projects its own predicate, so the
  // pair does not apply and the dashboard half stays hand-written.
  const listPublicEntry = definePublicEntry<TCommentList, CommentRpcTag>()({
    operation: "ListComments",
    remap: { action: "select", entity: "Comment" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  const addComment = createWrite.handlers((surface, args) =>
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
      // recorded; reconciliation closes any lost wake. Both RPC surfaces
      // record one, so both wake.
      yield* wakeEmailOutboxBestEffort(outboxId, args.organizationId);

      return {
        message: "Comment created successfully",
      };
    })
  );

  return {
    ListComments: (args: TCommentList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
          slug: args.slug,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Comment", "select")
        ),

    ListCommentsPublic: listPublicEntry.entry((args) =>
      Effect.gen(function* () {
        // A post on a plan-locked board is not publicly readable, so its
        // comments are not either; the exclusion stays inside the query.
        const lockedBoardIds = yield* entitlementPolicy.listLockedBoardIds(
          args.organizationId
        );

        return yield* withPublicViewer({
          read: (viewer) =>
            repository.findManyPublic({
              excludeBoardIds: [...lockedBoardIds],
              includeInternal: viewer.isMember(args.organizationId),
              organizationId: args.organizationId,
              slug: args.slug,
            }),
          redact: redactActorIdentities,
        });
      })
    ),

    CreateComment: addComment.dashboard,

    CreateCommentPublic: addComment.public,

    DeleteComment: removeComment.dashboard,

    DeleteCommentPublic: removeComment.public,

    UpdateComment: modifyComment.dashboard,

    UpdateCommentPublic: modifyComment.public,

    PinComment: (args: TCommentPin) =>
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

    UnpinComment: (args: TCommentUnpin) =>
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
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(CommentService.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(NotificationService.layer),
  Layer.provide(EmailOutboxConfig.layer)
);
