import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
  TChangelogCategorySet,
  TChangelogCategoryUpdate,
} from "./schema";

export const ChangelogCategoryRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogCategoryRepository;
  const categoryPolicy = yield* ChangelogCategoryPolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ListChangelogCategories: (args: TChangelogCategoryList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ChangelogCategory", "select")
        ),

    ListChangelogCategoriesPublic: (args: TChangelogCategoryList) =>
      repository.findManyPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListChangelogCategoriesPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("ChangelogCategory", "select")
      ),

    ListChangelogCategoryLinks: (args: TChangelogCategoryList) =>
      repository
        .findLinks(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("ChangelogCategory", "select")
        ),

    ListChangelogCategoryLinksPublic: (args: TChangelogCategoryList) =>
      repository.findLinksPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListChangelogCategoryLinksPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("ChangelogCategory", "select")
      ),

    CreateChangelogCategory: (args: TChangelogCategoryCreate) =>
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
              action: "changelog_category.created",
              resourceId: args.id,
              metadata: {
                name: args.name,
                iconType: args.iconType,
                icon: args.icon,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(categoryPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("ChangelogCategory", "create")
      ),

    UpdateChangelogCategory: (args: TChangelogCategoryUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.update(args);
            // The update returns nothing, so the new values go in `metadata`
            // rather than posing as a diff with an empty `before`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "changelog_category.updated",
              resourceId: args.id,
              metadata: {
                name: args.name,
                iconType: args.iconType,
                icon: args.icon,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(categoryPolicy.canUpdate(args.organizationId)),
        withRemapDbErrors("ChangelogCategory", "update")
      ),

    DeleteChangelogCategory: (args: TChangelogCategoryDelete) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.delete(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "changelog_category.deleted",
              resourceId: args.id,
            });
          })
        );
      }).pipe(
        Policy.withPolicy(categoryPolicy.canDelete(args.organizationId)),
        withRemapDbErrors("ChangelogCategory", "delete")
      ),

    SetChangelogCategories: (args: TChangelogCategorySet) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        const categoryIds = [...new Set(args.categoryIds)];
        // Two independent checks against the same workspace, run together as
        // one round trip. The verdicts are collected rather than raced, so the
        // changelog is still the one reported when both inputs are foreign.
        const [changelogCheck, categoryCheck] = yield* Effect.all(
          [
            validateChangelog({
              changelogId: args.changelogId,
              organizationId: args.organizationId,
            }),
            validateCategoryIds({
              organizationId: args.organizationId,
              categoryIds,
            }),
          ],
          { concurrency: "unbounded", mode: "result" }
        );
        yield* Effect.fromResult(changelogCheck);
        yield* Effect.fromResult(categoryCheck);

        yield* transaction(
          Effect.gen(function* () {
            yield* repository.setChangelogCategories({ ...args, categoryIds });
            // Filing an entry under categories changes the entry, not the
            // category rows, so this is `changelog.updated` with the changelog
            // as the resource: `changelog_category.updated` would name a
            // category id that did not change. Same shape as `SetPostTags`
            // recording `post.updated`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "changelog.updated",
              resourceId: args.changelogId,
              metadata: { categoryIds },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          categoryPolicy.canSetChangelogCategories({
            changelogId: args.changelogId,
            organizationId: args.organizationId,
          })
        ),
        withRemapDbErrors("ChangelogCategory", "update")
      ),
  };
});

const validateChangelog = ({
  changelogId,
  organizationId,
}: {
  changelogId: string;
  organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* ChangelogCategoryRepository;
    const exists = yield* repository.hasChangelog({
      changelogId,
      organizationId,
    });

    if (!exists) {
      return yield* new Policy.PolicyDeniedError({
        reason: "Changelog does not belong to this organization",
      });
    }
  });

const validateCategoryIds = ({
  organizationId,
  categoryIds,
}: {
  organizationId: string;
  categoryIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const repository = yield* ChangelogCategoryRepository;
    const count = yield* repository.countExistingCategories({
      organizationId,
      categoryIds,
    });

    if (count !== categoryIds.length) {
      return yield* new Policy.PolicyDeniedError({
        reason: "One or more categories do not belong to this organization",
      });
    }
  });

export const ChangelogCategoryRpcHandlers = ChangelogCategoryRpcs.toLayer(
  ChangelogCategoryRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(ChangelogCategoryPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(ChangelogCategoryRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
