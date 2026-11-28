import { transaction } from "@feeblo/db";
import { pickDefaultPostStatus } from "@feeblo/domain-contracts/post-status-default";
import { PostId } from "@feeblo/id";
import { markdownToHtmlCached } from "@feeblo/utils/markdown";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../attribute-definition/schema";
import { BoardRepository } from "../board/repository";
import { ChangelogRepository } from "../changelog/repository";
import { CompanyRepository } from "../company/repository";
import { DataValidationError } from "../contact/errors";
import { ContactRepository } from "../contact/repository";
import { parsePersonAttributes } from "../contact/utils";
import { EntitlementPolicy } from "../entitlement/policies";
import { makeHelpCenterSearch } from "../help-center-article/hybrid-search";
import { HelpCenterArticleRepository } from "../help-center-article/repository";
import { Api } from "../http/api";
import { JwtSecretRepository } from "../jwt-secret/repository";
import {
  maxTokenLifetimeFromMinutes,
  verifyJwt,
} from "../jwt-secret/verification";
import { OrganizationRepository } from "../organization/repository";
import { PolicyDeniedError } from "../policy";
import { PostStatusRepository } from "../post-status/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { makePostSuggestions } from "../post/suggestions";
import { PostWriteService } from "../post/write";
import * as RateLimit from "../rate-limit";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { buildPublicSiteUrl, PortalUrlConfig } from "../site/url";
import { ParticipationPolicy } from "../user-ban/policies";
import { WidgetCreateFeedbackErrors } from "./api-contract";
import {
  type TWidgetFeedbackMetadata,
  WidgetFeedbackMetadataValue,
} from "./schema";
import { upsertContactFromParsed } from "./sso";

/**
 * The failures the widget feedback endpoint publishes from the token
 * transaction.
 *
 * `verifyJwt` answers `UnauthorizedError` (expired, bad signature, wrong
 * audience, missing claims), `parsePersonAttributes` answers
 * `DataValidationError` (missing or malformed claims), and a banned SSO
 * identity answers `PolicyDeniedError`. All three are in the endpoint's
 * declared error union, so the write path passes them through; everything
 * else in the token transaction is a contact-store failure and is answered as
 * internal.
 */
const isPublishedFeedbackFailure = <T>(
  error: T
): error is T & (UnauthorizedError | DataValidationError | PolicyDeniedError) =>
  Schema.is(UnauthorizedError)(error) ||
  Schema.is(DataValidationError)(error) ||
  Schema.is(PolicyDeniedError)(error);

export const listWidgetUpdates = Effect.fn("Widget.listUpdates")(function* ({
  organizationId,
}: {
  organizationId: string;
}) {
  const repository = yield* ChangelogRepository;
  const sitePolicy = yield* SitePolicy;

  // This endpoint is unauthenticated and `organizationId` arrives in the query
  // string, so the workspace's changelog privacy is the only thing standing
  // between a caller and a changelog the owner chose to hide. `canViewChangelog`
  // is the same policy `changelog/handlers.ts` and the email outbox apply; not
  // applying it here is what let a hidden changelog be read by anyone who knew
  // the org id.
  const isChangelogPublic = yield* sitePolicy
    .canViewChangelog(organizationId)
    .pipe(
      Effect.as(true),
      Effect.catchTag("PolicyDenied", () => Effect.succeed(false))
    );

  // A hidden changelog answers `[]` rather than an error. The board app treats
  // it as "no changelog" (`apps/web/src/lib/public-board-data.ts`), and an
  // error status on an unauthenticated, caller-named organization would confirm
  // that the workspace exists.
  if (!isChangelogPublic) {
    return [];
  }

  const entries = yield* repository.findManyPublished({ organizationId });

  return entries.map((entry) => {
    // Changelog rows store already-sanitized Markdown (see
    // `changelog/handlers.ts`), so render through the isolate-local HTML
    // cache instead of re-running the three-pipeline sanitizer for every
    // entry on every request. `markdownToHtml` still drops unsafe URLs
    // (`rehypeSafeUrlAttributes`), keeping pre-sanitization rows safe.
    const sanitizedHtml = markdownToHtmlCached(
      `${entry.id}:${String(entry.updatedAt)}`,
      entry.content
    );

    return {
      id: entry.id,
      title: entry.title,
      slug: entry.slug,
      content: sanitizedHtml,
      excerpt: entry.excerpt,
      imageUrl: entry.coverImage,
      publishedAt: entry.publishedAt ?? entry.createdAt,
    };
  });
});

/**
 * Help-center articles that may already answer the question being written.
 *
 * Two answers, one shape. `enabled: false` covers every case where the
 * surface does not exist — the workspace is on a site with no help center, or
 * the workspace has none — and the widget needs that as a value rather than a
 * failure so it can stop asking instead of polling an endpoint that will keep
 * returning nothing.
 *
 * The visibility check is the predicate `SitePolicy.canViewHelpCenter`
 * applies, answered as "nothing" rather than an error. That difference is
 * deliberate here: this endpoint is unauthenticated and names the workspace in
 * its body, so a distinguishable failure would confirm which workspaces exist.
 * The same reasoning keeps a hidden changelog answering `[]`.
 *
 * The search is `strict`, so a hit means the term is in an article's title or
 * summary. A suggestion beside a feedback form is only worth showing if it
 * names the thing being asked about; a body match on a passing mention would be
 * a worse suggestion than none.
 *
 * A workspace whose corpus is empty answers `enabled: false` too. The composer
 * asks this on every settle of the title, so the emptiness is one existence
 * read before the search, not a list read per keystroke; and answering it here
 * is what stops a public workspace with no documentation from searching for a
 * match it can never return.
 */
export const findWidgetHelpArticles = Effect.fn("Widget.helpArticles")(
  function* ({
    organizationId,
    query,
  }: {
    organizationId: string;
    query: string;
  }) {
    const siteRepository = yield* SiteRepository;

    const site = yield* siteRepository
      .findByOrganizationId({ organizationId })
      .pipe(Effect.map(Option.getOrUndefined));

    if (site === undefined || site.helpCenterVisibility !== "PUBLIC") {
      return { articles: [], enabled: false };
    }

    // The readable set is the lifecycle's, not "published" alone: an archived
    // article is a tombstone the portal and the widget still serve, so a corpus
    // that holds only tombstones is not empty and `findManyPublic` would return
    // those rows. The repository owns the query so this check and the list
    // cannot disagree about what readable means.
    const repository = yield* HelpCenterArticleRepository;

    if (!(yield* repository.hasReadableByOrganizationId({ organizationId }))) {
      return { articles: [], enabled: false };
    }

    const config = yield* PortalUrlConfig;

    // The same program the dashboard and portal run, built without an embedder:
    // the deflection is strict and a strict search never reaches the semantic
    // pass, so a deployment with no API key still answers it. Going through the
    // program rather than straight to the repository is what keeps "strict"
    // meaning one thing across the three surfaces.
    const search = makeHelpCenterSearch({
      embeddings: Option.none(),
      lexical: repository.search,
      semantic: repository.searchByVector,
    });

    const hits = yield* search({
      includeUnreadable: false,
      limit: 3,
      organizationId,
      query,
      strict: true,
    });

    // Counted, because "the widget offered documentation and the reader posted
    // anyway" and "the widget found nothing" are the two facts that say whether
    // the deflection is working. A failed counter never fails the suggestion.
    const now = yield* DateTime.now;

    yield* repository
      .recordSearch({ found: hits.length > 0, now, organizationId, query })
      .pipe(
        Effect.tapCause((cause) =>
          Effect.logWarning(
            "Failed to record a widget help center search",
            cause
          )
        ),
        Effect.ignoreCause
      );

    const portalUrl = buildPublicSiteUrl(site, config.rootDomain);

    return {
      articles: hits.map((hit) => ({
        excerpt: hit.excerpt,
        id: hit.id,
        title: hit.title,
        // Absolute, because the iframe is embedded on the customer's own origin:
        // a relative link would resolve against the host page.
        url: `${portalUrl}/s/help/articles/${encodeURIComponent(hit.slug)}`,
      })),
      enabled: true,
    };
  }
);

/**
 * Whether the widget may read this workspace's help center.
 *
 * The same two answers as the deflection — the workspace's site visibility,
 * and (at the call site) whether anything is published — as one value rather
 * than an error, for the same reason: the endpoint is unauthenticated and
 * names the workspace, so a distinguishable failure would confirm which
 * workspaces exist. `false` hides the widget's Help tab instead of showing a
 * surface that will never fill.
 */
const widgetHelpCenterAvailable = Effect.fn("Widget.helpCenterAvailable")(
  function* ({ organizationId }: { organizationId: string }) {
    const siteRepository = yield* SiteRepository;

    const site = yield* siteRepository
      .findByOrganizationId({ organizationId })
      .pipe(Effect.map(Option.getOrUndefined));

    return site !== undefined && site.helpCenterVisibility === "PUBLIC";
  }
);

/**
 * Every published article, with its section, for the widget's Help module.
 *
 * One read rather than a topic list beside an article list: `findManyPublic`
 * already orders by the section's own position and then by the article's, so
 * grouping these rows in order reproduces the tree the portal renders. The
 * widget is a few hundred kilobytes of iframe; a second round trip to learn
 * section names it can read off the rows is not worth it.
 */
export const listWidgetHelpCenter = Effect.fn("Widget.helpCenter")(function* ({
  organizationId,
}: {
  organizationId: string;
}) {
  const available = yield* widgetHelpCenterAvailable({ organizationId });

  if (!available) {
    return { articles: [], enabled: false };
  }

  const repository = yield* HelpCenterArticleRepository;

  const articles = yield* repository.findManyPublic({ organizationId });

  return {
    articles: articles.map((article) => ({
      excerpt: article.excerpt,
      id: article.id,
      isArchived: article.isArchived,
      slug: article.slug,
      title: article.title,
      topicId: article.topicId,
      topicName: article.topicName,
      topicSlug: article.topicSlug,
    })),
    // `enabled` also answers "is there anything to show": the widget's tab is
    // decided by this value alone, so a public workspace with an empty help
    // center must not get a tab that opens an empty page.
    enabled: articles.length > 0,
  };
});

/**
 * One published article, rendered to HTML.
 *
 * `article: null` covers a slug that is not published here, which is the same
 * answer as one that does not exist: a reader (or a crawler) cannot tell a
 * draft from a typo, and neither should be able to.
 */
export const readWidgetHelpCenterArticle = Effect.fn(
  "Widget.helpCenterArticle"
)(function* ({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  const available = yield* widgetHelpCenterAvailable({ organizationId });

  if (!available) {
    return { article: null, enabled: false };
  }

  const repository = yield* HelpCenterArticleRepository;

  const article = yield* repository.findBySlugPublic({ organizationId, slug });

  if (article === undefined) {
    return { article: null, enabled: true };
  }

  return {
    article: {
      // Cached per version, like the updates module: the body is stored
      // Markdown and rendering it per request would be the expensive part of
      // this endpoint. The pipeline still drops unsafe URLs.
      content: markdownToHtmlCached(
        `${article.id}:${String(article.updatedAt)}`,
        article.content
      ),
      isArchived: article.isArchived,
      slug: article.slug,
      title: article.title,
      topicName: article.topicName,
      updatedAt: article.updatedAt,
    },
    enabled: true,
  };
});

/**
 * Resolves the SSO customer a feedback submission is attributed to.
 *
 * The contact upsert and the participation check run in one transaction, so a
 * banned submission rolls back the contact it just created: a denial leaves
 * neither a post nor a contact behind. Reads and providers are passed in
 * rather than resolved from the context so a test can exercise this step
 * without building the whole widget HTTP surface.
 */
export const resolveFeedbackContact = (input: {
  readonly organizationId: string;
  readonly token: string;
  readonly attributeDefinitionRepository: AttributeDefinitionRepository["Service"];
  readonly entitlementPolicy: EntitlementPolicy["Service"];
  readonly jwtSecretRepository: JwtSecretRepository["Service"];
  readonly organizationRepository: OrganizationRepository["Service"];
  readonly participation: ParticipationPolicy["Service"];
}) =>
  transaction(
    Effect.gen(function* () {
      const secrets = yield* input.jwtSecretRepository.getSecretsForOrg({
        organizationId: input.organizationId,
      });

      if (secrets.length === 0) {
        return yield* new UnauthorizedError({
          message: "Organization has no JWT secret configured",
        });
      }

      // Per-workspace lifetime cap tightens (never loosens) the 24h default;
      // invalid stored values fall back to the default.
      const maxTokenLifetimeMinutes =
        yield* input.organizationRepository.findJwtMaxTokenLifetimeMinutes({
          organizationId: input.organizationId,
        });

      const maxTokenLifetime = maxTokenLifetimeFromMinutes(
        maxTokenLifetimeMinutes
      );

      const contactDefs =
        // SAFETY: the repository contract returns contact attribute definitions
        // in the canonical domain shape; the cast bridges the DB-row encoding.
        (yield* input.attributeDefinitionRepository.findContactAttributeDefinitions(
          input.organizationId
        )) as readonly TContactAttributeDefinition[];

      const companyDefs =
        // SAFETY: the repository contract returns company attribute definitions
        // in the canonical domain shape; the cast bridges the DB-row encoding.
        (yield* input.attributeDefinitionRepository.findCompanyAttributeDefinitions(
          input.organizationId
        )) as readonly TCompanyAttributeDefinition[];

      const jwtPayload = yield* verifyJwt(
        input.token,
        secrets.map((secret) => secret.secret),
        input.organizationId,
        { maxTokenLifetime }
      );

      const parsedContact = yield* parsePersonAttributes(
        jwtPayload,
        contactDefs,
        companyDefs
      );

      const contactId = yield* upsertContactFromParsed(
        input.organizationId,
        parsedContact
      );

      yield* input.participation.canSubjectParticipate({
        organizationId: input.organizationId,
        ...(contactId !== undefined && { contactId }),
      });

      return contactId;
    })
  ).pipe(
    // The contact upsert reads the plan decision and the attribute
    // definitions from the context; provide the instances the caller captured
    // rather than rebuilding them inside the transaction.
    Effect.provideService(
      AttributeDefinitionRepository,
      input.attributeDefinitionRepository
    ),
    Effect.provideService(EntitlementPolicy, input.entitlementPolicy),
    // A rejected or malformed SSO token is the caller's mistake, and the
    // endpoint publishes both tags for it: answer with the real 401/400
    // instead of folding them into a 500 that says the server failed and can
    // never be retried. A ban denial is published as the same 403 the
    // portal answers. `mapError`, not `catchIf`: the type predicate is what
    // removes the contact-store errors from the channel, so the handler's
    // declared error union stays exact.
    Effect.mapError((error) =>
      isPublishedFeedbackFailure(error)
        ? error
        : new InternalServerError({
            message: "Failed to create feedback contact",
          })
    )
  );

/**
 * The widget HTTP surface, composed once.
 *
 * The feedback write is the shared post write path (`post/write.ts`), built
 * here at group construction so a widget submission lands in the same
 * timeline, webhook, staff notification, submission email window, and search
 * embedding as a dashboard or Public API create. The group depends on the
 * shared `PostWriteService`; the pieces only this surface's handlers touch
 * stay in the layer build below.
 */
export const WidgetApiLive = HttpApiBuilder.group(
  Api,
  "WidgetApiGroup",
  (handlers) =>
    Effect.gen(function* () {
      const attributeDefinitionRepository =
        yield* AttributeDefinitionRepository;

      const boardRepository = yield* BoardRepository;
      const changelogRepository = yield* ChangelogRepository;
      const companyRepository = yield* CompanyRepository;
      const contactRepository = yield* ContactRepository;
      const jwtSecretRepository = yield* JwtSecretRepository;
      const organizationRepository = yield* OrganizationRepository;
      const postStatusRepository = yield* PostStatusRepository;
      const sitePolicy = yield* SitePolicy;
      const writes = yield* PostWriteService;
      const entitlementPolicy = yield* EntitlementPolicy;
      const postRepository = yield* PostRepository;
      const postEmbeddings = yield* PostEmbeddingService;
      const participation = yield* ParticipationPolicy;
      const helpCenterArticles = yield* HelpCenterArticleRepository;
      const siteRepository = yield* SiteRepository;
      const portalUrlConfig = yield* PortalUrlConfig;

      // The same suggestion program the dashboard and public portal RPCs run,
      // with the widget's public-only rule. Its collaborators are captured
      // here so the handler does not build a layer per request.
      const suggestions = makePostSuggestions({
        candidates: postRepository.findSuggestionCandidates,
        embeddings: Option.some(postEmbeddings),
      });

      /**
       * The handler's own services, provided around the feedback effect.
       *
       * `HttpApiBuilder` reads a handler's requirements from its own effect,
       * so these are closed over here rather than left to the route layer;
       * the shared write path's environment comes from `PostWriteService`.
       */
      const provideHandlerEnvironment = <A, E, R>(
        effect: Effect.Effect<A, E, R>
      ) =>
        effect.pipe(
          Effect.provideService(
            AttributeDefinitionRepository,
            attributeDefinitionRepository
          ),
          Effect.provideService(BoardRepository, boardRepository),
          Effect.provideService(ChangelogRepository, changelogRepository),
          Effect.provideService(CompanyRepository, companyRepository),
          Effect.provideService(ContactRepository, contactRepository),
          Effect.provideService(JwtSecretRepository, jwtSecretRepository),
          Effect.provideService(OrganizationRepository, organizationRepository),
          Effect.provideService(PostStatusRepository, postStatusRepository),
          Effect.provideService(SitePolicy, sitePolicy),
          Effect.provideService(
            HelpCenterArticleRepository,
            helpCenterArticles
          ),
          Effect.provideService(SiteRepository, siteRepository),
          Effect.provideService(PortalUrlConfig, portalUrlConfig)
        );

      return handlers
        .handle("listUpdates", ({ payload }) =>
          listWidgetUpdates(payload).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetListUpdates",
              level: "read",
            }),
            provideHandlerEnvironment,
            withRemapDbErrors("Changelog", "select")
          )
        )
        .handle("suggestPosts", ({ payload }) =>
          suggestions({ ...payload, publicOnly: true }).pipe(
            Effect.map((posts) =>
              posts.map(({ id, title, excerpt, slug }) => ({
                id,
                title,
                excerpt,
                slug,
              }))
            ),
            Effect.mapError(
              (cause) =>
                new InternalServerError({
                  message: "Failed to find similar posts",
                  cause,
                })
            ),
            withRemapDbErrors("Post", "select"),
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetSuggestPosts",
              level: "expensive",
            })
          )
        )
        .handle("helpArticles", ({ payload }) =>
          findWidgetHelpArticles(payload).pipe(
            // A failure propagates, and the client's own `failed` state keeps
            // the panel empty without latching `enabled: false`. Swallowing it
            // into `enabled: false` would tell the widget the workspace has no
            // help center — permanently, for that session — on a transient
            // database error. Creating feedback is a separate request, so a
            // failed hint cannot block it either way.
            provideHandlerEnvironment,
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetHelpArticles",
              level: "read",
            }),
            withRemapDbErrors("HelpCenterArticle", "select")
          )
        )
        .handle("listBoards", ({ payload }) =>
          Effect.gen(function* () {
            const repository = yield* BoardRepository;

            const boards = yield* repository.findMany({
              organizationId: payload.organizationId,
              visibility: "PUBLIC",
            });

            return boards.map(({ visibility: _visibility, ...board }) => board);
          }).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetListBoards",
              level: "read",
            }),
            provideHandlerEnvironment,
            withRemapDbErrors("Boards", "select")
          )
        )
        .handle("helpCenter", ({ payload }) =>
          listWidgetHelpCenter(payload).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetHelpCenter",
              level: "read",
            }),
            provideHandlerEnvironment,
            withRemapDbErrors("HelpCenterArticle", "select")
          )
        )
        .handle("helpCenterArticle", ({ payload }) =>
          readWidgetHelpCenterArticle(payload).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetHelpCenterArticle",
              level: "read",
            }),
            provideHandlerEnvironment,
            withRemapDbErrors("HelpCenterArticle", "select")
          )
        )
        .handle("createFeedback", ({ payload }) => {
          const { boardId, organizationId, title, content, metadata, token } =
            payload;

          return Effect.gen(function* () {
            const boardRepository = yield* BoardRepository;
            const postStatusRepository = yield* PostStatusRepository;

            // Defense-in-depth re-validation of the public request metadata
            // before it is stored / delivered downstream (webhooks, email,
            // embeddings). The endpoint schema already bounds this at the
            // wire, but re-applying the same limits here guarantees the
            // persisted JSONB and every derived payload stay bounded even if
            // the endpoint schema is ever widened.
            const validatedMetadata: TWidgetFeedbackMetadata | undefined =
              metadata === undefined
                ? undefined
                : yield* Schema.decodeEffect(WidgetFeedbackMetadataValue)(
                    metadata
                  ).pipe(
                    Effect.mapError(
                      (cause) =>
                        new DataValidationError({
                          message: "Invalid feedback metadata",
                          cause,
                        })
                    )
                  );

            const board = yield* boardRepository.getById({
              id: boardId,
              organizationId,
            });

            if (Option.isNone(board)) {
              return yield* new NotFoundError({ message: "Board not found" });
            }

            if (board.value.visibility !== "PUBLIC") {
              return yield* new DataValidationError({
                message: "Board is not public",
              });
            }

            const statuses = yield* postStatusRepository.findMany({
              organizationId,
            });

            const defaultStatus = pickDefaultPostStatus(statuses);

            if (!defaultStatus) {
              return yield* new InternalServerError({
                message: "Organization has no post statuses configured",
              });
            }

            // The SSO contact upsert and the participation check share one
            // transaction: a banned submission rolls back the contact it just
            // created, so a denial leaves neither a post nor a contact. The
            // post write itself runs afterwards, so a later write failure still
            // leaves a known customer in place.
            const contactId = token
              ? yield* resolveFeedbackContact({
                  attributeDefinitionRepository,
                  entitlementPolicy,
                  jwtSecretRepository,
                  organizationId,
                  organizationRepository,
                  participation,
                  token,
                })
              : undefined;

            const id = yield* PostId.generate;
            const now = yield* DateTime.nowAsDate;

            const slug = yield* writes.create(
              {
                assetIds: [],
                // An SSO-attributed submission names its customer; an
                // anonymous one has nobody to attribute to.
                ...(contactId !== undefined && { author: { contactId } }),
                boardId,
                content,
                id,
                metadata: validatedMetadata ?? {},
                organizationId,
                source: "WIDGET",
                statusId: defaultStatus.id,
                title,
              },
              { kind: "api_key" }
            );

            return {
              id,
              slug,
              title,
              boardId,
              organizationId,
              createdAt: now,
            };
          }).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetCreateFeedback",
              level: "write",
            }),
            provideHandlerEnvironment,
            Effect.catchTags({
              PostAlreadyExistsError: () =>
                Effect.logWarning(
                  "Exhausted post slug candidates while creating widget feedback; post was not stored",
                  { organizationId, boardId }
                ).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new InternalServerError({
                        message: "Failed to create feedback",
                      })
                    )
                  )
                ),
            }),
            withRemapDbErrors("Feedback", "create"),
            // The endpoint publishes a closed error union; every other failure
            // the shared write path can produce — a private board's policy
            // refusal, a subject/CRM refusal from an SSO attribution — is
            // answered as internal, which is the same 500 an undeclared
            // failure produced before the error channel was typed.
            Effect.mapError((error) =>
              Schema.is(WidgetCreateFeedbackErrors)(error)
                ? error
                : new InternalServerError({
                    message: "Failed to create feedback",
                  })
            )
          );
        });
    })
).pipe(
  Layer.provide(
    Layer.mergeAll(
      AttributeDefinitionRepository.layer,
      BoardRepository.layer,
      ChangelogRepository.layer,
      CompanyRepository.layer,
      ContactRepository.layer,
      HelpCenterArticleRepository.layer,
      JwtSecretRepository.layer,
      OrganizationRepository.layer,
      PortalUrlConfig.layer,
      PostEmbeddingService.layer,
      PostRepository.layer,
      PostStatusRepository.layer,
      // Provided into the policy rather than beside it: `Layer.mergeAll`
      // builds in parallel, so a layer that depends on a sibling in the same
      // call is a layer whose dependency is not there yet. The repository is
      // still in the merge for the handler's own lookup of the workspace's
      // public host, which is why both appear.
      SitePolicy.layer.pipe(Layer.provide(SiteRepository.layer)),
      SiteRepository.layer,
      ParticipationPolicy.layer
    )
  )
);
