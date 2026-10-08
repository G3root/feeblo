import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { PostStatusRepository } from "./repository";
import { PostStatusRpcs } from "./rpcs";
import type {
  TPostStatusCreate,
  TPostStatusDelete,
  TPostStatusDeletePreview,
  TPostStatusList,
  TPostStatusReorder,
  TPostStatusUpdate,
} from "./schema";

export const PostStatusRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostStatusRepository;
  const read = (organizationId: string) => Policy.hasMembership(organizationId);
  // Statuses are the workspace's own vocabulary, the same kind of thing as
  // tags, changelog categories and roadmap columns, so they are managed at the
  // same level: manager and above.
  const manage = (organizationId: string) =>
    Policy.canPermission(organizationId, "statuses.*");

  return {
    PostStatusList: (args: TPostStatusList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(read(args.organizationId)),
          withRemapDbErrors("PostStatus", "select")
        ),
    PostStatusListPublic: (args: TPostStatusList) =>
      // Statuses are org-public by design: the public portal renders every
      // post with its status label, so the status catalog must be readable
      // without a session (a member-only status list would leak nothing more
      // but would break the portal's rendering for anonymous visitors). The
      // endpoint is per-IP rate limited; no PII is returned (id/name/color/
      // kind only).
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "PostStatusListPublic",
            level: "read",
          }),
          withRemapDbErrors("PostStatus", "select")
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
