import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChangelogPolicy } from "../changelog/policies";
import { ChangelogRepository } from "../changelog/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogPostRepository } from "./repository";
import { ChangelogPostRpcs } from "./rpcs";
import type {
  TChangelogPostCreate,
  TChangelogPostDelete,
  TChangelogPostList,
} from "./schema";

export const ChangelogPostRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogPostRepository;
  const changelogPolicy = yield* ChangelogPolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ChangelogPostList: (args: TChangelogPostList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ChangelogPost", "select")
        ),

    ChangelogPostListPublic: (args: TChangelogPostList) =>
      repository
        .findManyPublished(args)
        .pipe(
          Policy.withPublicPolicy(
            sitePolicy.canViewChangelog(args.organizationId)
          ),
          withRemapDbErrors("ChangelogPost", "select")
        ),

    ChangelogPostCreate: (args: TChangelogPostCreate) =>
      Effect.gen(function* () {
        const eligible = yield* repository.findEligible(args);
        if (eligible.length === 0) {
          return yield* new Policy.PolicyDeniedError({
            reason:
              "Post is not an unannounced completed post in this organization",
          });
        }
        yield* repository.create(args);
      }).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.changelogId,
          })
        ),
        withRemapDbErrors("ChangelogPost", "create")
      ),

    ChangelogPostDelete: (args: TChangelogPostDelete) =>
      repository.delete(args).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.changelogId,
          })
        ),
        withRemapDbErrors("ChangelogPost", "delete")
      ),
  };
});

export const ChangelogPostRpcHandlers = ChangelogPostRpcs.toLayer(
  ChangelogPostRpcHandlersEffect
).pipe(
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(ChangelogPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(SitePolicy.layer),
  Layer.provide(ChangelogPostRepository.layer),
  Layer.provide(ChangelogRepository.layer)
);
