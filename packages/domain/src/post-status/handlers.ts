import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { defineSurfacePair } from "../surface";
import { PostStatusRepository } from "./repository";
import { PostStatusRpcs } from "./rpcs";
import type {
  TPostStatusCreate,
  TPostStatusDelete,
  TPostStatusDeletePreview,
  TPostStatusList,
  TPostStatusMakeDefault,
  TPostStatusReorder,
  TPostStatusUpdate,
} from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type PostStatusRpcTag = RpcTagsOf<typeof PostStatusRpcs>;

export const PostStatusRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostStatusRepository;
  const read = (organizationId: string) => Policy.hasMembership(organizationId);
  // Statuses are the workspace's own vocabulary, the same kind of thing as
  // tags, changelog categories and roadmap columns, so they are managed at the
  // same level: manager and above.
  const manage = (organizationId: string) =>
    Policy.canPermission(organizationId, "statuses.*");

  // -- Surface-parameterized reads --
  //
  // Statuses are org-public by design: the public portal renders every post
  // with its status label, so the catalog must be readable without a session.
  // The public read is per-IP rate limited and returns no PII (id/name/color/
  // kind only).

  const listRead = defineSurfacePair<TPostStatusList, PostStatusRpcTag>()({
    operation: "ListPostStatuses",
    remap: { action: "select", entity: "PostStatus" },
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostStatusList) => read(args.organizationId),
    },
    public: {
      rateLimit: "read",
      policy: (_args: TPostStatusList) => Policy.allow,
    },
  });

  const listStatuses = listRead.handlers((_surface, args) =>
    repository.findMany({ organizationId: args.organizationId })
  );

  return {
    ListPostStatuses: listStatuses.dashboard,
    ListPostStatusesPublic: listStatuses.public,
    CreatePostStatus: (args: TPostStatusCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post_status.created",
              resourceId: args.id,
              metadata: { label: args.label, type: args.type },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(manage(args.organizationId)),
        withRemapDbErrors({
          action: "create",
          entity: "PostStatus",
          // Both values that can collide are client-supplied: the id the
          // optimistic row already used, and the position the settings page
          // computed from the rows it had. A collision means the client was
          // working from a stale list, which is a bad request rather than a
          // server fault.
          onUniqueViolation: () =>
            new BadRequestError({
              message:
                "Another status already holds this id or position. Reload the page and try again.",
            }),
        })
      ),
    UpdatePostStatus: (args: TPostStatusUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.update(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post_status.updated",
              resourceId: args.id,
              metadata: { label: args.label, type: args.type },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(manage(args.organizationId)),
        withRemapDbErrors("PostStatus", "update")
      ),
    SetPostStatusDefault: (args: TPostStatusMakeDefault) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.makeDefault(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post_status.updated",
              resourceId: args.id,
              metadata: { isDefault: true },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(manage(args.organizationId)),
        withRemapDbErrors("PostStatus", "update")
      ),
    DeletePostStatus: (args: TPostStatusDelete) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        return yield* transaction(
          Effect.gen(function* () {
            const removed = yield* repository.delete(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post_status.deleted",
              resourceId: args.id,
            });
            return removed;
          })
        );
      }).pipe(
        Policy.withPolicy(manage(args.organizationId)),
        withRemapDbErrors("PostStatus", "delete")
      ),
    PreviewPostStatusDelete: (args: TPostStatusDeletePreview) =>
      repository
        .previewDelete(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "select")
        ),
    ReorderPostStatuses: (args: TPostStatusReorder) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.reorder(args);
            // A reorder touches every status at once, so it is one page-level
            // entry rather than an update per row.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "post_status.updated",
              resourceId: args.organizationId,
              metadata: { order: args.orderedIds },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(manage(args.organizationId)),
        withRemapDbErrors("PostStatus", "update")
      ),
  };
});

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  PostStatusRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostStatusRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
