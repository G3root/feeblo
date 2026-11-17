import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { ChangelogPolicy } from "../changelog/policies";
import { ChangelogRepository } from "../changelog/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
    ListChangelogPosts: (args: TChangelogPostList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ChangelogPost", "select")
        ),

    ListChangelogPostsPublic: (args: TChangelogPostList) =>
      repository.findManyPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListChangelogPostsPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("ChangelogPost", "select")
      ),

    CreateChangelogPost: (args: TChangelogPostCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        const eligible = yield* repository.findEligible(args);

        if (eligible.length === 0) {
          return yield* new Policy.PolicyDeniedError({
            reason:
              "Post is not an unannounced completed post in this organization",
          });
        }

        // changelogPolicy.canUpdate additionally requires the changelog to
        // belong to this organization, so a manager cannot link this
        // organization's post to another organization's changelog.
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create(args);
            // A link row is not a resource of its own in the catalog; the
            // meaningful fact is that the changelog entry now announces this
            // post, so it is recorded as an update of the entry.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "changelog.updated",
              resourceId: args.changelogId,
              metadata: { postId: args.postId, linked: true },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.changelogId,
          })
        ),
        withRemapDbErrors("ChangelogPost", "create")
      ),

    DeleteChangelogPost: (args: TChangelogPostDelete) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            const { deleted } = yield* repository.delete(args);

            // A link that was not there — already removed, or a post that was
            // never linked — changed nothing, and an `unlinked` entry for it
            // would describe an edit the entry never had.
            if (!deleted) {
              return;
            }

            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "changelog.updated",
              resourceId: args.changelogId,
              metadata: { postId: args.postId, linked: false },
            });
          })
        );
      }).pipe(
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
  Layer.provide(ChangelogRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
