import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogCategoryPolicy } from "./policies";
import { ChangelogCategoryRepository } from "./repository";
import { ChangelogCategoryRpcs } from "./rpcs";
import type {
  TChangelogCategoryCreate,
  TChangelogCategoryDelete,
  TChangelogCategoryList,
  TChangelogCategoryUpdate,
} from "./schema";

export const ChangelogCategoryRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogCategoryRepository;
  const categoryPolicy = yield* ChangelogCategoryPolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ChangelogCategoryList: (args: TChangelogCategoryList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ChangelogCategory", "select")
        ),

    ChangelogCategoryListPublic: (args: TChangelogCategoryList) =>
      repository.findMany(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogCategoryListPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("ChangelogCategory", "select")
      ),

    ChangelogCategoryCreate: (args: TChangelogCategoryCreate) =>
      repository
        .create(args)
        .pipe(
          Policy.withPolicy(categoryPolicy.canCreate(args.organizationId)),
          withRemapDbErrors("ChangelogCategory", "create")
        ),

    ChangelogCategoryUpdate: (args: TChangelogCategoryUpdate) =>
      repository.update(args).pipe(
        Policy.withPolicy(
          categoryPolicy.canUpdate({
            organizationId: args.organizationId,
            categoryId: args.id,
          })
        ),
        withRemapDbErrors("ChangelogCategory", "update")
      ),

    ChangelogCategoryDelete: (args: TChangelogCategoryDelete) =>
      repository.delete(args).pipe(
        Policy.withPolicy(
          categoryPolicy.canDelete({
            organizationId: args.organizationId,
            categoryId: args.id,
          })
        ),
        withRemapDbErrors("ChangelogCategory", "delete")
      ),
  };
});

export const ChangelogCategoryRpcHandlers = ChangelogCategoryRpcs.toLayer(
  ChangelogCategoryRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(ChangelogCategoryPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(ChangelogCategoryRepository.layer)
);
