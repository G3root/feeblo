import { Database, transaction } from "@feeblo/db";
import { pickDefaultPostStatus } from "@feeblo/domain-contracts/post-status-default";
import { PostId } from "@feeblo/id";
import { markdownToHtmlCached } from "@feeblo/utils/markdown";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../attribute-definition/schema";
import { BoardRepository } from "../board/repository";
import { ChangelogRepository } from "../changelog/repository";
import { ClientIp } from "../client-ip";
import { CompanyRepository } from "../company/repository";
import { DataValidationError } from "../contact/errors";
import { ContactRepository } from "../contact/repository";
import { parsePersonAttributes } from "../contact/utils";
import { EntitlementPolicy } from "../entitlement/policies";
import { JwtSecretRepository } from "../jwt-secret/repository";
import {
  maxTokenLifetimeFromMinutes,
  verifyJwt,
} from "../jwt-secret/verification";
import { OrganizationRepository } from "../organization/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { makePostSuggestions } from "../post/suggestions";
import { PostWriteService } from "../post/write";
import * as RateLimit from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import {
  WidgetApi,
  WidgetApiGroup,
  WidgetCreateFeedbackErrors,
} from "./api-contract";
import {
  type TWidgetFeedbackMetadata,
  WidgetFeedbackMetadataValue,
} from "./schema";
import { upsertContactFromParsed } from "./sso";

/**
 * The failures the widget feedback endpoint publishes for a bad SSO token.
 *
 * `verifyJwt` answers `UnauthorizedError` (expired, bad signature, wrong
 * audience, missing claims) and `parsePersonAttributes` answers
 * `DataValidationError` (missing or malformed claims). Both are in the
 * endpoint's declared error union, so the write path passes them through;
 * everything else in the token transaction is a contact-store failure and is
 * answered as internal.
 */
const isFeedbackTokenFailure = <T>(
  error: T
): error is T & (UnauthorizedError | DataValidationError) =>
  Schema.is(UnauthorizedError)(error) || Schema.is(DataValidationError)(error);

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
 * The services a widget handler reads while it answers a request.
 *
 * This is the surface's whole reading list, declared once. The group builder
 * captures it as one `Context` when the route is built and every handler below
 * closes over that context, so a service a handler reads and this list omits
 * fails the handler's `WidgetHandler` type, and a service this list names and
 * the route does not supply fails `./router.ts`'s layer type. The previous
 * shape listed the same services twice — once as `yield*`, once as
 * `Effect.provideService` — and proved neither direction; see docs/adr/0006.
 *
 * `ClientIp` is deliberately absent: the global client-IP middleware supplies
 * it per request, so it does not exist when the group is built and cannot be
 * captured.
 */
export type WidgetApiDependencies =
  | AttributeDefinitionRepository
  | BoardRepository
  | ChangelogRepository
  | CompanyRepository
  | ContactRepository
  | Crypto.Crypto
  | Database.Database
  | EntitlementPolicy
  | JwtSecretRepository
  | OrganizationRepository
  | PostEmbeddingService
  | PostRepository
  | PostStatusRepository
  | PostWriteService
  | RateLimitService
  | SitePolicy;

/** The group as composed, so a handler is typed against its own endpoints. */
type ComposedWidgetGroup = InstanceType<typeof WidgetApiGroup>;

/**
 * One endpoint's implementation.
 *
 * `ClientIp` is the handler's entire residual requirement: the rate limiter
 * reads it from the request, and the global client-IP middleware supplies it
 * there. Stating it is what makes a handler that reads anything outside
 * `WidgetApiDependencies` a compile error instead of a missing-service defect
 * on a live request.
 */
type WidgetHandler<Identifier extends keyof ComposedWidgetGroup["endpoints"]> =
  HttpApiEndpoint.Handler<
    ComposedWidgetGroup["endpoints"][Identifier],
    HttpApiEndpoint.MiddlewareError<
      ComposedWidgetGroup["endpoints"][Identifier]
    >,
    ClientIp
  >;

/**
 * The widget HTTP surface, composed once, against its own `HttpApi`.
 *
 * The feedback write is the shared post write path (`post/write.ts`), so a
 * widget submission lands in the same timeline, webhook, staff notification,
 * submission email window, and search embedding as a dashboard or Public API
 * create. `PostWriteService` is a captured dependency; the write path's
 * optional fan-outs stay request-context reads, which is why the route needs
 * them supplied (`apps/server/src/app/layers.ts`).
 *
 * The group is registered on `WidgetApi`, not the dashboard's `Api`: the
 * widget is its own surface with its own route (`./router.ts`), and its
 * endpoints therefore no longer appear in the dashboard's `/docs/openapi.json`.
 */
export const WidgetApiLive = HttpApiBuilder.group(
  WidgetApi,
  "WidgetApiGroup",
  (handlers) =>
    Effect.gen(function* () {
      // The one declaration of what this surface reads. `HttpApiBuilder` serves
      // a handler with the context its group was built in, so capturing it here
      // is what puts the list in the group layer's requirement channel; the
      // handlers close over `context`, which is also what proves the list
      // complete.
      const context = yield* Effect.context<WidgetApiDependencies>();

      // The same suggestion program the dashboard and public portal RPCs run,
      // with the widget's public-only rule. Its collaborators are read here so
      // the handler does not build a layer per request.
      const suggestions = makePostSuggestions({
        candidates: (yield* PostRepository).findSuggestionCandidates,
        embeddings: Option.some(yield* PostEmbeddingService),
      });

      return handlers
        .handle("listUpdates", (({ payload }) =>
          listWidgetUpdates(payload).pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetListUpdates",
              level: "read",
            }),
            withRemapDbErrors("Changelog", "select"),
            Effect.provideContext(context)
          )) satisfies WidgetHandler<"listUpdates">)
        .handle("suggestPosts", (({ payload }) =>
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
              () =>
                new InternalServerError({
                  message: "Failed to find similar posts",
                })
            ),
            withRemapDbErrors("Post", "select"),
            RateLimit.withPublicHttpRateLimit({
              name: "WidgetSuggestPosts",
              level: "expensive",
            }),
            Effect.provideContext(context)
          )) satisfies WidgetHandler<"suggestPosts">)
        .handle("listBoards", (({ payload }) =>
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
            withRemapDbErrors("Boards", "select"),
            Effect.provideContext(context)
          )) satisfies WidgetHandler<"listBoards">)
        .handle("createFeedback", (({ payload }) => {
          const { boardId, organizationId, title, content, metadata, token } =
            payload;

          return Effect.gen(function* () {
            const boardRepository = yield* BoardRepository;
            const postStatusRepository = yield* PostStatusRepository;
            const jwtSecretRepository = yield* JwtSecretRepository;
            const attributeDefinitionRepository =
              yield* AttributeDefinitionRepository;
            // The shared write path. Its own environment is provided once by
            // `PostWriteService.layer` at the composition root, so this is the
            // one tag the widget depends on for a submission to land in the
            // same timeline, webhook, notification, and embedding pipeline as
            // a dashboard or Public API create.
            const writes = yield* PostWriteService;

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
            const defaultStatus = pickDefaultPostStatus(statuses);

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
                  // A rejected or malformed SSO token is the caller's mistake,
                  // and the endpoint publishes both tags for it: answer with
                  // the real 401/400 instead of folding them into a 500 that
                  // says the server failed and can never be retried. Only the
                  // contact-store failures left in this effect are internal.
                  // `mapError`, not `catchIf`: the type predicate is what
                  // removes the contact-store errors from the channel, so the
                  // handler's declared error union stays exact.
                  Effect.mapError((error) =>
                    isFeedbackTokenFailure(error)
                      ? error
                      : new InternalServerError({
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
            ),
            Effect.provideContext(context)
          );
        }) satisfies WidgetHandler<"createFeedback">);
    })
);
