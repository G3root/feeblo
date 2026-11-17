import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterTopicRepository } from "../help-center-topic/repository";
import { helpCenterFeatureGate } from "../help-center/flag";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import {
  FailedToDeleteHelpCenterArticleError,
  HelpCenterArticleChangedError,
  HelpCenterArticleSlugTakenError,
} from "./errors";
import { canTransitionHelpCenterArticle } from "./machine";
import { HelpCenterArticlePolicy } from "./policies";
import { HelpCenterArticleRepository } from "./repository";
import { HelpCenterArticleRpcs } from "./rpcs";
import type {
  THelpCenterArticleCreate,
  THelpCenterArticleDelete,
  THelpCenterArticleGet,
  THelpCenterArticleGetPublic,
  THelpCenterArticleList,
  THelpCenterArticleListPublic,
  THelpCenterArticleUpdate,
  THelpCenterArticleViewRecord,
} from "./schema";
import { normalizeArticleWrite } from "./write";

const notFound = () =>
  new NotFoundError({ message: "The article does not exist." });

export const HelpCenterArticleRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* HelpCenterArticleRepository;
  const articlePolicy = yield* HelpCenterArticlePolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ListHelpCenterArticles: (args: THelpCenterArticleList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(articlePolicy.canRead(args.organizationId)),
          withRemapDbErrors("HelpCenterArticle", "select"),
          Policy.withPublicPolicy(helpCenterFeatureGate)
        ),

    ListHelpCenterArticlesPublic: (args: THelpCenterArticleListPublic) =>
      repository.findManyPublic(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListHelpCenterArticlesPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewHelpCenter(args.organizationId)
        ),
        withRemapDbErrors("HelpCenterArticle", "select"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    GetHelpCenterArticle: (args: THelpCenterArticleGet) =>
      repository.findById(args).pipe(
        Effect.filterOrFail((found) => found !== undefined, notFound),
        Policy.withPolicy(articlePolicy.canRead(args.organizationId)),
        withRemapDbErrors("HelpCenterArticle", "select"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    GetHelpCenterArticlePublic: (args: THelpCenterArticleGetPublic) =>
      repository.findBySlugPublic(args).pipe(
        Effect.filterOrFail((found) => found !== undefined, notFound),
        RateLimit.withPublicRpcRateLimit({
          name: "GetHelpCenterArticlePublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewHelpCenter(args.organizationId)
        ),
        withRemapDbErrors("HelpCenterArticle", "select"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    CreateHelpCenterArticle: (args: THelpCenterArticleCreate) =>
      Effect.gen(function* () {
        yield* articlePolicy.topicBelongsToWorkspace(args);

        const now = yield* DateTime.nowAsDate;

        const write = yield* normalizeArticleWrite({
          content: args.content,
          now,
          previousPublishedAt: null,
          requestedPublishedAt: args.publishedAt,
          slug: args.slug,
          status: args.status,
          title: args.title,
        });

        yield* repository.create({
          id: args.id,
          organizationId: args.organizationId,
          topicId: args.topicId,
          position: args.position,
          now,
          write,
        });
      }).pipe(
        Policy.withPolicy(articlePolicy.canCreate(args)),
        withRemapDbErrors({
          action: "create",
          entity: "HelpCenterArticle",
          onUniqueViolation: () =>
            new HelpCenterArticleSlugTakenError({
              slug: args.slug ?? args.title,
            }),
        }),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    UpdateHelpCenterArticle: (args: THelpCenterArticleUpdate) =>
      Effect.gen(function* () {
        yield* articlePolicy.topicBelongsToWorkspace(args);

        const previous = yield* repository.findStateById(args);

        if (previous === undefined) {
          return yield* notFound();
        }

        // The status is a lifecycle, not a free field: an update asks the same
        // graph the editor's picker is derived from, so a move the graph calls
        // unreachable (`draft → archived`, because a page nobody published is
        // deleted rather than withdrawn) is refused here rather than stored as
        // a row the machine cannot explain. A create names an initial state and
        // has no previous state to move from, so it is not subject to this.
        if (
          previous.status !== args.status &&
          !canTransitionHelpCenterArticle(previous.status, args.status)
        ) {
          return yield* new BadRequestError({
            message: `An article cannot move from ${previous.status} to ${args.status}.`,
          });
        }

        const now = yield* DateTime.nowAsDate;

        // The previous date is what keeps a typo fix from looking like a new
        // release: a republish keeps the date the article first went live
        // unless the caller names a new one.
        const write = yield* normalizeArticleWrite({
          content: args.content,
          now,
          previousPublishedAt: previous.publishedAt,
          requestedPublishedAt: args.publishedAt,
          slug: args.slug,
          status: args.status,
          title: args.title,
        });

        const updated = yield* repository.update({
          id: args.id,
          organizationId: args.organizationId,
          topicId: args.topicId,
          position: args.position,
          // What the editor had on screen, not what this request just read: a
          // colleague's save in between is a conflict, not an overwrite. An
          // API caller that does not track it falls back to the row as read,
          // which is the weaker guarantee but the only one it can offer.
          expectedStatus: args.expectedStatus ?? previous.status,
          now,
          write,
        });

        if (updated.length === 0) {
          return yield* new HelpCenterArticleChangedError();
        }
      }).pipe(
        Policy.withPolicy(articlePolicy.canUpdate(args.organizationId)),
        withRemapDbErrors({
          action: "update",
          entity: "HelpCenterArticle",
          onUniqueViolation: () =>
            new HelpCenterArticleSlugTakenError({ slug: args.slug }),
        }),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    DeleteHelpCenterArticle: (args: THelpCenterArticleDelete) =>
      repository.remove(args).pipe(
        Policy.withPolicy(articlePolicy.canDelete(args.organizationId)),
        withRemapDbErrors({
          action: "delete",
          entity: "HelpCenterArticle",
          onUniqueViolation: () => new FailedToDeleteHelpCenterArticleError(),
        }),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    /**
     * The view beacon.
     *
     * It answers `accepted: false` for an article the reader could not open and
     * `accepted: true` for one it stored or deduplicated. It never fails on a
     * bad article, because a failure would be the enumeration channel the
     * response shape is designed not to be.
     */
    AddHelpCenterArticleView: (args: THelpCenterArticleViewRecord) =>
      repository.recordView(args).pipe(
        // The beacon is a count, not a feature: any failure to store one is
        // answered as "not accepted" so a reader's page is never blocked by its
        // own analytics. Catching the whole channel rather than one tag is
        // deliberate — the failure can arrive as a driver error, an abort, or a
        // serialization failure, and none of them is the reader's problem. The
        // rate limit and the surface gate below still propagate: a refusal is
        // the caller's business.
        Effect.orElseSucceed(() => ({ accepted: false })),
        RateLimit.withPublicRpcRateLimit({
          name: "AddHelpCenterArticleView",
          level: "write",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewHelpCenter(args.organizationId)
        ),
        // Last, as in every public read: the policy's own site lookup can fail
        // with a driver error, so the remap has to run after it to leave one
        // failure vocabulary on the channel.
        withRemapDbErrors("HelpCenterArticleView", "upsert"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),
  };
});

export const HelpCenterArticleRpcHandlers = HelpCenterArticleRpcs.toLayer(
  HelpCenterArticleRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(HelpCenterArticlePolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(HelpCenterTopicRepository.layer),
  Layer.provide(HelpCenterArticleRepository.layer)
);
