import { transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  cleanupOrphanedEditorAssets,
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  rollbackPreparedEditorAssets,
  syncChangelogAssetReferences,
} from "../asset/service";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";
import { ChangelogRpcs } from "./rpcs";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

export const ChangelogRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ChangelogRepository;
  const changelogPolicy = yield* ChangelogPolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ChangelogList: (args: TChangelogList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Changelog", "select")
        ),

    ChangelogListPublic: (args: TChangelogList) =>
      repository.findManyPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogListPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
        withRemapDbErrors("Changelog", "select")
      ),

    ChangelogCreate: (args: TChangelogCreate) => {
      const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: sanitizedMarkdown,
          assetIds: args.assetIds,
        });
        const isMember = Policy.getMembership(session, args.organizationId);

        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create({
              ...args,
              content: prepared.content,
              creatorId: session.session.userId,
              ...(isMember ? { creatorMemberId: isMember.membershipId } : {}),
            });
            yield* commitPreparedEditorAssets(prepared.promotions);
            yield* syncChangelogAssetReferences({
              changelogId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
            });
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
        );
      }).pipe(
        Policy.withPolicy(changelogPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Changelog", "create")
      );
    },

    ChangelogDelete: (args: TChangelogDelete) =>
      repository.delete(args).pipe(
        Effect.tap(() =>
          cleanupOrphanedEditorAssets({
            organizationId: args.organizationId,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Failed to clean up orphaned editor assets",
                cause
              ).pipe(
                Effect.annotateLogs({ organizationId: args.organizationId })
              )
            )
          )
        ),
        Policy.withPolicy(
          changelogPolicy.canDelete({
            organizationId: args.organizationId,
            changelogId: args.id,
          })
        ),
        withRemapDbErrors("Changelog", "delete")
      ),

    ChangelogUpdate: (args: TChangelogUpdate) => {
      const { sanitizedMarkdown } = sanitizeMarkdown(args.content);
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: sanitizedMarkdown,
          assetIds: args.assetIds,
        });

        yield* transaction(
          Effect.gen(function* () {
            yield* repository.update({
              ...args,
              content: prepared.content,
            });
            yield* commitPreparedEditorAssets(prepared.promotions);
            yield* syncChangelogAssetReferences({
              changelogId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
            });
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          Effect.ensuring(cleanupPreparedEditorAssets(prepared.promotions))
        );
      }).pipe(
        Policy.withPolicy(
          changelogPolicy.canUpdate({
            organizationId: args.organizationId,
            changelogId: args.id,
          })
        ),
        withRemapDbErrors("Changelog", "update")
      );
    },
  };
});

export const ChangelogRpcHandlers = ChangelogRpcs.toLayer(
  ChangelogRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(ChangelogPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(ChangelogRepository.layer)
);
