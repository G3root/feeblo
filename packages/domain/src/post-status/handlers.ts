import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import {
  type Surface,
  type SurfacePair,
  withSurfacePolicy,
  withSurfaceRateLimit,
} from "../surface";
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

  const listRead = {
    operation: "PostStatusList",
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostStatusList) => read(args.organizationId),
    },
    public: {
      rateLimit: "read",
      policy: (_args: TPostStatusList) => Policy.allow,
    },
  } satisfies SurfacePair<TPostStatusList, PostStatusRpcTag>;

  const listStatuses = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
    P extends Policy.Policy<unknown, unknown>,
  >(
    surface: Surface,
    level: Level,
    policy: P,
    args: TPostStatusList
  ) =>
    repository
      .findMany({
        organizationId: args.organizationId,
      })
      .pipe(
        withSurfacePolicy(policy),
        withRemapDbErrors("PostStatus", "select"),
        withSurfaceRateLimit({ level, operation: listRead.operation, surface })
      );

  return {
    PostStatusList: (args: TPostStatusList) =>
      listStatuses(
        "dashboard",
        listRead.dashboard.rateLimit,
        listRead.dashboard.policy(args),
        args
      ),
    PostStatusListPublic: (args: TPostStatusList) =>
      listStatuses(
        "public",
        listRead.public.rateLimit,
        listRead.public.policy(args),
        args
      ),
    PostStatusCreate: (args: TPostStatusCreate) =>
      repository.create(args).pipe(
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
    PostStatusUpdate: (args: TPostStatusUpdate) =>
      repository
        .update(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
    PostStatusMakeDefault: (args: TPostStatusMakeDefault) =>
      repository
        .makeDefault(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
    PostStatusDelete: (args: TPostStatusDelete) =>
      repository
        .delete(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "delete")
        ),
    PostStatusDeletePreview: (args: TPostStatusDeletePreview) =>
      repository
        .previewDelete(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "select")
        ),
    PostStatusReorder: (args: TPostStatusReorder) =>
      repository
        .reorder(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("PostStatus", "update")
        ),
  };
});

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  PostStatusRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostStatusRepository.layer)
);
