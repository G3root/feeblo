import { transaction } from "@feeblo/db";
import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  cleanupPreparedEditorAssets,
  commitPreparedEditorAssets,
  prepareEditorAssetContent,
  rollbackPreparedEditorAssets,
  syncHelpCenterArticleAssetReferences,
} from "../asset/service";
import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterTopicRepository } from "../help-center-topic/repository";
import { helpCenterFeatureGate } from "../help-center/flag";
import * as Policy from "../policy";
import { PostEmbeddingService } from "../post/embedding-service";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import {
  type HelpCenterEmbedder,
  type HelpCenterEmbedding,
  scheduleHelpCenterArticleEmbedding,
} from "./embedding";
import {
  FailedToDeleteHelpCenterArticleError,
  HelpCenterArticleChangedError,
  HelpCenterArticleSlugTakenError,
} from "./errors";
import { makeHelpCenterSearch } from "./hybrid-search";
import {
  canTransitionHelpCenterArticle,
  isHelpCenterArticleReadable,
} from "./machine";
import { HelpCenterArticlePolicy } from "./policies";
import { HelpCenterArticleRepository } from "./repository";
import { HelpCenterArticleRpcs } from "./rpcs";
import {
  HELP_CENTER_ANALYTICS_RANGE_DAYS,
  type THelpCenterAnalyticsPayload,
  type THelpCenterArticleCreate,
  type THelpCenterArticleDelete,
  type THelpCenterArticleGet,
  type THelpCenterArticleGetPublic,
  type THelpCenterArticleList,
  type THelpCenterArticleListPublic,
  type THelpCenterArticleSearch,
  type THelpCenterArticleSearchPublic,
  type THelpCenterArticleUpdate,
  type THelpCenterArticleViewRecord,
} from "./schema";
import { normalizeArticleWrite } from "./write";

const notFound = () =>
  new NotFoundError({ message: "The article does not exist." });

export const HelpCenterArticleRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* HelpCenterArticleRepository;
  const articlePolicy = yield* HelpCenterArticlePolicy;
  const sitePolicy = yield* SitePolicy;

  /**
   * The deployment's embedder, when it has one.
   *
   * `serviceOption` rather than a layer requirement: an embedding service is an
   * enhancement, and a process that has no API key configured must still serve
   * a help center. The service is the post module's only because there is one
   * model, one dimension, one key and one vector space — the article column and
   * `post.embedding` are the same width and compared with the same metric, so a
   * second embedder would be a second source of truth about which vectors may
   * be compared.
   */
  const embeddingService = yield* Effect.serviceOption(PostEmbeddingService);

  /**
   * The deployment's embedder behind this module's infallible port.
   *
   * The provider's errors — a dimension mismatch, a timeout, an AI-layer
   * failure — are all "we could not embed this" from here, and the caller
   * treats them the same way: log, and let the article save or the search
   * answer without a vector. Absorbing them here is what keeps a provider's
   * union out of the write path's error channel.
   */
  const embeddings = Option.map(
    embeddingService,
    (service): HelpCenterEmbedder => ({
      embed: (input) =>
        service
          .embed(input)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Failed to generate a help center embedding",
                cause
              ).pipe(Effect.as(Option.none<HelpCenterEmbedding>()))
            )
          ),
    })
  );

  const search = makeHelpCenterSearch({
    embeddings,
    lexical: repository.search,
    semantic: repository.searchByVector,
  });

  /**
   * Refresh an article's search embedding after a write, detached.
   *
   * Only for a state a reader can open: embedding a draft would spend a model
   * call on a page no search may return, and the publication that makes it
   * readable is itself an update, which schedules its own job.
   */
  const scheduleEmbedding = (args: {
    readonly articleId: string;
    readonly content: string;
    readonly organizationId: string;
    readonly status: THelpCenterArticleState;
    readonly title: string;
  }) =>
    Effect.gen(function* () {
      if (
        !isHelpCenterArticleReadable(args.status) ||
        Option.isNone(embeddings)
      ) {
        return;
      }

      yield* scheduleHelpCenterArticleEmbedding({
        articleId: args.articleId,
        content: args.content,
        embedder: embeddings.value,
        organizationId: args.organizationId,
        repository,
        title: args.title,
      });
    });

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

        const session = yield* CurrentSession;
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

        // Promote the images this save references out of the temporary prefix
        // before the row stores their URLs. A promotion is an object copy, so
        // it has to be undone when the write below fails: `rollback` deletes
        // the permanent copies, while the temporary originals survive so the
        // editor's next attempt can promote them again.
        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: write.content,
          assetIds: args.assetIds,
          coverImageUrl: args.coverImage,
        });

        const stored = { ...write, content: prepared.content };

        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create({
              id: args.id,
              organizationId: args.organizationId,
              topicId: args.topicId,
              position: args.position,
              now,
              write: stored,
              coverImage: prepared.coverImage,
            });

            yield* commitPreparedEditorAssets(prepared.promotions);
            // Record what the row references before the transaction commits:
            // the orphan sweep keeps an asset alive through these rows, just
            // as a post and a changelog record theirs.
            yield* syncHelpCenterArticleAssetReferences({
              articleId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
              coverImageUrl: prepared.coverImage,
            });
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          // Only a committed article makes its temporary originals disposable.
          // Removing them on a failed write would leave the editor's retry
          // pointing at objects that no longer exist.
          Effect.tap(() => cleanupPreparedEditorAssets(prepared.promotions))
        );

        yield* scheduleEmbedding({
          articleId: args.id,
          content: stored.content,
          organizationId: args.organizationId,
          status: stored.status,
          title: stored.title,
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

        const session = yield* CurrentSession;
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

        const prepared = yield* prepareEditorAssetContent({
          organizationId: args.organizationId,
          userId: session.session.userId,
          content: write.content,
          assetIds: args.assetIds,
          coverImageUrl: args.coverImage,
        });

        const stored = { ...write, content: prepared.content };

        yield* transaction(
          Effect.gen(function* () {
            const updated = yield* repository.update({
              id: args.id,
              organizationId: args.organizationId,
              topicId: args.topicId,
              position: args.position,
              // What the editor had on screen, not what this request just read:
              // a colleague's save in between is a conflict, not an overwrite.
              // An API caller that does not track it falls back to the row as
              // read, which is the weaker guarantee but the only one it offers.
              expectedStatus: args.expectedStatus ?? previous.status,
              now,
              write: stored,
              coverImage: prepared.coverImage,
            });

            if (updated.length === 0) {
              return yield* new HelpCenterArticleChangedError();
            }

            yield* commitPreparedEditorAssets(prepared.promotions);
            // The reference rows are what keeps the orphan sweep from
            // deleting a promoted image once it is an hour old; they move in
            // the same transaction as the content that names their URLs.
            yield* syncHelpCenterArticleAssetReferences({
              articleId: args.id,
              organizationId: args.organizationId,
              userId: session.session.userId,
              content: prepared.content,
              assetIds: args.assetIds,
              coverImageUrl: prepared.coverImage,
            });
          })
        ).pipe(
          Effect.tapCause(() =>
            rollbackPreparedEditorAssets(prepared.promotions)
          ),
          // A refused update — a slug conflict, a stale status — keeps the
          // temporary originals so the editor can retry the same upload.
          Effect.tap(() => cleanupPreparedEditorAssets(prepared.promotions))
        );

        yield* scheduleEmbedding({
          articleId: args.id,
          content: stored.content,
          organizationId: args.organizationId,
          status: stored.status,
          title: stored.title,
        });
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

    /**
     * The dashboard's search.
     *
     * It counts no analytics: an editor searching their own workspace is not a
     * reader looking for an answer, and counting it would make the "top
     * searches" list an inventory of the team's drafts.
     */
    SearchHelpCenterArticles: (args: THelpCenterArticleSearch) =>
      search({
        includeUnreadable: true,
        limit: args.limit ?? 10,
        organizationId: args.organizationId,
        query: args.query,
      }).pipe(
        Policy.withPolicy(articlePolicy.canRead(args.organizationId)),
        withRemapDbErrors("HelpCenterArticle", "select"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    /**
     * The portal's search, and the only public read that writes.
     *
     * The counter is recorded after the rows are read, because "found" is the
     * length of the answer. It is swallowed on failure: a reader's search must
     * not fail because the analytics table is unavailable, and the read is the
     * product.
     */
    SearchHelpCenterArticlesPublic: (args: THelpCenterArticleSearchPublic) =>
      Effect.gen(function* () {
        const hits = yield* search({
          includeUnreadable: false,
          limit: args.limit ?? 10,
          organizationId: args.organizationId,
          query: args.query,
        });

        const now = yield* DateTime.now;

        yield* repository
          .recordSearch({
            found: hits.length > 0,
            now,
            organizationId: args.organizationId,
            query: args.query,
          })
          .pipe(
            // Logged before it is discarded: the counter is advisory, but a
            // write that has been failing for a week should be visible in the
            // logs rather than absent from them.
            Effect.tapCause((cause) =>
              Effect.logWarning("Failed to record a help center search", cause)
            ),
            Effect.ignoreCause
          );

        return hits.map((hit) => ({
          excerpt: hit.excerpt,
          id: hit.id,
          isArchived: hit.status === "archived",
          slug: hit.slug,
          title: hit.title,
          topicName: hit.topicName,
          topicSlug: hit.topicSlug,
        }));
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          level: "read",
          name: "SearchHelpCenterArticlesPublic",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewHelpCenter(args.organizationId)
        ),
        withRemapDbErrors("HelpCenterArticle", "select"),
        Policy.withPublicPolicy(helpCenterFeatureGate)
      ),

    /**
     * The dashboard's analytics.
     *
     * The window's first day is computed here rather than in the repository, so
     * "now" is read through `Clock` once at the edge and a test can pin the
     * range without reaching into the query.
     */
    GetHelpCenterAnalytics: (args: THelpCenterAnalyticsPayload) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;

        // A window of N days is N dates *including* today, so the first day
        // is `today - (N - 1)`. Subtracting N would make "7 days" an
        // eight-date range and quietly widen every number the panel shows.
        const since = DateTime.formatIsoDateUtc(
          DateTime.subtract({
            days: HELP_CENTER_ANALYTICS_RANGE_DAYS[args.range] - 1,
          })(now)
        );

        const result = yield* repository.analytics({
          limit: 10,
          organizationId: args.organizationId,
          sinceDay: since,
        });

        return { ...result, range: args.range, since };
      }).pipe(
        Policy.withPolicy(articlePolicy.canRead(args.organizationId)),
        withRemapDbErrors("HelpCenterArticleAnalytics", "select"),
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
