import { transaction } from "@feeblo/db";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { scheduleAssetDeletions, stageAssetDeletions } from "../asset/deletion";
import { AssetRepository } from "../asset/repository";
import { extractAssetUrlsFromContent } from "../asset/urls";
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
        const isMember = Policy.getMembership(session, args.organizationId);

        yield* repository.create({
          ...args,
          content: sanitizedMarkdown,
          creatorId: session.session.userId,
          ...(isMember ? { creatorMemberId: isMember.membershipId } : {}),
        });
      }).pipe(
        Policy.withPolicy(changelogPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Changelog", "create")
      );
    },

    ChangelogDelete: (args: TChangelogDelete) =>
      Effect.gen(function* () {
        const assetRepository = yield* AssetRepository;
        const editorAssets = yield* transaction(
          Effect.gen(function* () {
            const content = yield* repository.findContent({
              id: args.id,
              organizationId: args.organizationId,
            });
            const urls = extractAssetUrlsFromContent(content);
            const remainingUrls = new Set(
              yield* assetRepository.findReferencedUrls({
                urls,
                excludeChangelogIds: [args.id],
                excludePostIds: [],
                organizationId: args.organizationId,
              })
            );
            const editorAssets = yield* assetRepository.findByUrls({
              organizationId: args.organizationId,
              urls: urls.filter((url) => !remainingUrls.has(url)),
            });

            yield* stageAssetDeletions(editorAssets);
            yield* repository.delete(args);
            return editorAssets;
          })
        );
        yield* scheduleAssetDeletions(editorAssets).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to schedule deleted changelog asset cleanup",
              cause
            ).pipe(
              Effect.annotateLogs({
                changelogId: args.id,
                organizationId: args.organizationId,
              })
            )
          )
        );
      }).pipe(
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
      return repository
        .update({
          ...args,
          content: sanitizedMarkdown,
        })
        .pipe(
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
  Layer.provide(ChangelogRepository.layer),
  Layer.provide(AssetRepository.layer)
);
