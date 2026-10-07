import { transaction } from "@feeblo/db";
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
import { Api } from "../http/api";
import { JwtSecretRepository } from "../jwt-secret/repository";
import {
  maxTokenLifetimeFromMinutes,
  verifyJwt,
} from "../jwt-secret/verification";
import { OrganizationRepository } from "../organization/repository";
import { PostStatusRepository } from "../post-status/repository";
import {
  PostEmbeddingService,
  postEmbeddingInput,
} from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import {
  postLexicalSimilarity,
  SUGGESTION_MAX_DISTANCE,
} from "../post/suggestions";
import { PostWriteService } from "../post/write";
import * as RateLimit from "../rate-limit";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import {
  type TWidgetFeedbackMetadata,
  WidgetFeedbackMetadataValue,
} from "./schema";
import { upsertContactFromParsed } from "./sso";

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
          Effect.provideService(SitePolicy, sitePolicy)
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
          Effect.gen(function* () {
            const repository = yield* PostRepository;
            const embeddings = yield* PostEmbeddingService;
            const input = postEmbeddingInput(payload);
            const queryEmbedding = yield* embeddings
              .embed(input)
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    "Failed to generate widget suggestion embedding",
                    cause
                  ).pipe(Effect.as(Option.none()))
                )
              );
            const candidates = yield* repository.findSuggestionCandidates({
              boardId: payload.boardId,
              organizationId: payload.organizationId,
              publicOnly: true,
              limit: Option.isSome(queryEmbedding) ? 5 : 25,
              ...(Option.isSome(queryEmbedding) && {
                embedding: queryEmbedding.value.vector,
                embeddingModel: queryEmbedding.value.model,
              }),
            });
            if (Option.isSome(queryEmbedding)) {
              const matches = candidates
                .filter(
                  (candidate) =>
                    candidate.distance !== null &&
                    candidate.distance <= SUGGESTION_MAX_DISTANCE
                )
                .map(({ id, title, excerpt, slug }) => ({
                  id,
                  title,
                  excerpt,
                  slug,
                }));
              if (matches.length > 0) {
                return matches;
              }
            }

            const lexicalCandidates = Option.isSome(queryEmbedding)
              ? yield* repository.findSuggestionCandidates({
                  boardId: payload.boardId,
                  organizationId: payload.organizationId,
                  publicOnly: true,
                  limit: 25,
                })
              : candidates;

            return lexicalCandidates
              .map((post) => ({
                post,
                score: postLexicalSimilarity(input, post),
              }))
              .filter(({ score }) => score > 0)
              .sort((left, right) => right.score - left.score)
              .slice(0, 5)
              .map(({ post: { id, title, excerpt, slug } }) => ({
                id,
                title,
                excerpt,
                slug,
              }));
          }).pipe(
            Effect.provide([PostEmbeddingService.layer, PostRepository.layer]),
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Failed to find similar posts",
                })
            ),
            withRemapDbErrors("Post", "select"),
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetSuggestPosts",
              level: "expensive",
            })
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
        .handle("createFeedback", ({ payload }) => {
          const { boardId, organizationId, title, content, metadata, token } =
            payload;

          return Effect.gen(function* () {
            const boardRepository = yield* BoardRepository;
            const postStatusRepository = yield* PostStatusRepository;
            const jwtSecretRepository = yield* JwtSecretRepository;
            const attributeDefinitionRepository =
              yield* AttributeDefinitionRepository;

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
                      () =>
                        new DataValidationError({
                          message: "Invalid feedback metadata",
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
            const defaultStatus = statuses[0];

            if (!defaultStatus) {
              return yield* new InternalServerError({
                message: "Organization has no post statuses configured",
              });
            }

            // The write path sanitizes and owns the transaction; the
            // attribution subject is resolved inside it from the customer
            // record this upsert files. The upsert joins its own transaction
            // first: the contact is a durable customer record, and a failed
            // feedback write leaves it in place rather than rolling back a
            // customer the workspace knows about.
            const contactId = token
              ? yield* transaction(
                  Effect.gen(function* () {
                    const secrets = yield* jwtSecretRepository.getSecretsForOrg(
                      {
                        organizationId,
                      }
                    );

                    if (secrets.length === 0) {
                      return yield* new UnauthorizedError({
                        message: "Organization has no JWT secret configured",
                      });
                    }

                    // Per-workspace lifetime cap tightens (never loosens) the
                    // 24h default; invalid stored values fall back to the
                    // default.
                    const organizationRepository =
                      yield* OrganizationRepository;
                    const maxTokenLifetimeMinutes =
                      yield* organizationRepository.findJwtMaxTokenLifetimeMinutes(
                        {
                          organizationId,
                        }
                      );
                    const maxTokenLifetime = maxTokenLifetimeFromMinutes(
                      maxTokenLifetimeMinutes
                    );

                    const contactDefs =
                      // SAFETY: the repository contract returns contact attribute definitions
                      // in the canonical domain shape; the cast bridges the DB-row encoding.
                      (yield* attributeDefinitionRepository.findContactAttributeDefinitions(
                        organizationId
                      )) as readonly TContactAttributeDefinition[];
                    const companyDefs =
                      // SAFETY: the repository contract returns company attribute definitions
                      // in the canonical domain shape; the cast bridges the DB-row encoding.
                      (yield* attributeDefinitionRepository.findCompanyAttributeDefinitions(
                        organizationId
                      )) as readonly TCompanyAttributeDefinition[];

                    const jwtPayload = yield* verifyJwt(
                      token,
                      secrets.map((s) => s.secret),
                      organizationId,
                      { maxTokenLifetime }
                    );

                    const parsedContact = yield* parsePersonAttributes(
                      jwtPayload,
                      contactDefs,
                      companyDefs
                    );

                    return yield* upsertContactFromParsed(
                      organizationId,
                      parsedContact
                    );
                  })
                ).pipe(
                  Effect.mapError(
                    () =>
                      new InternalServerError({
                        message: "Failed to create feedback contact",
                      })
                  )
                )
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
              ConfigError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Missing APP_URL for widget integration events",
                  })
                ),
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
            withRemapDbErrors("Feedback", "create")
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
      JwtSecretRepository.layer,
      OrganizationRepository.layer,
      PostStatusRepository.layer,
      SitePolicy.layer
    )
  )
);
