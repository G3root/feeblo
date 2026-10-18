import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { defineSurfacePair } from "../surface";
import { WorkspaceRepository } from "../workspace/repository";
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
  const entitlementPolicy = yield* EntitlementPolicy;
  const read = (organizationId: string) => Policy.hasMembership(organizationId);
  // Statuses are the workspace's own vocabulary, the same kind of thing as
  // tags, changelog categories and roadmap columns, so they are managed at the
  // same level: manager and above.
  const manage = (organizationId: string) =>
    Policy.canPermission(organizationId, "statuses.*");
  // Creating and editing statuses is a write; deleting one is cleanup and
  // stays open so a locked workspace can still reduce its vocabulary.
  const manageWritable = (organizationId: string) =>
    Policy.all(
      manage(organizationId),
      entitlementPolicy.assertWorkspaceWritable(organizationId)
    );

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
      repository.create(args).pipe(
        Policy.withPolicy(manageWritable(args.organizationId)),
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
      repository
        .update(args)
        .pipe(
          Policy.withPolicy(manageWritable(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
    SetPostStatusDefault: (args: TPostStatusMakeDefault) =>
      repository
        .makeDefault(args)
        .pipe(
          Policy.withPolicy(manageWritable(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
    DeletePostStatus: (args: TPostStatusDelete) =>
      repository
        .delete(args)
        .pipe(
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
      repository
        .reorder(args)
        .pipe(
          Policy.withPolicy(manageWritable(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
  };
});

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  PostStatusRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(PostStatusRepository.layer)
);
