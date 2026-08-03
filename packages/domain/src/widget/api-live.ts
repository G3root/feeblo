import { transaction } from "@feeblo/db";
import { PostId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
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
import { verifyJwt } from "../jwt-secret/verification";
import {
  PostEmbeddingService,
  postEmbeddingInput,
  schedulePostEmbeddingBestEffort,
} from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import {
  postLexicalSimilarity,
  SUGGESTION_MAX_DISTANCE,
} from "../post/suggestions";
import { PostStatusRepository } from "../post-status/repository";
import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { upsertContactFromParsed } from "./sso";

const UPDATE_IMAGE_SOURCE = /<img[^>]+src=["']([^"']+)["']/i;

export const listWidgetUpdates = Effect.fn("Widget.listUpdates")(function* ({
  organizationId,
}: {
  organizationId: string;
}) {
  const repository = yield* ChangelogRepository;
  const entries = yield* repository.findManyPublished({ organizationId });

  return entries.map((entry) => {
    const { sanitizedHtml } = sanitizeMarkdown(entry.content);
    const imageMatch = sanitizedHtml.match(UPDATE_IMAGE_SOURCE);
    return {
      id: entry.id,
      title: entry.title,
      slug: entry.slug,
      content: sanitizedHtml,
      excerpt: htmlToExcerpt(sanitizedHtml),
      imageUrl: imageMatch?.[1] ?? null,
      publishedAt: entry.publishedAt ?? entry.createdAt,
    };
  });
});

export const WidgetApiLive = HttpApiBuilder.group(
  Api,
  "WidgetApiGroup",
  (handlers) =>
    handlers
      .handle("listUpdates", ({ payload }) =>
        listWidgetUpdates(payload).pipe(
          Effect.provide(ChangelogRepository.layer),
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
            ...(Option.isSome(queryEmbedding)
              ? {
                  embedding: queryEmbedding.value.vector,
                  embeddingModel: queryEmbedding.value.model,
                }
              : {}),
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
          withRemapDbErrors("Post", "select")
        )
      )
      .handle("listBoards", ({ payload }) =>
        Effect.gen(function* () {
          const { organizationId } = payload;
          const repository = yield* BoardRepository;
          const boards = yield* repository.findMany({
            organizationId,
            visibility: "PUBLIC",
          });

          return boards.map(({ visibility: _visibility, ...board }) => board);
        }).pipe(
          Effect.provide(BoardRepository.layer),
          withRemapDbErrors("Boards", "select")
        )
      )
      .handle("createFeedback", ({ payload }) =>
        Effect.gen(function* () {
          const { boardId, organizationId, title, content, metadata, token } =
            payload;

          const boardRepository = yield* BoardRepository;
          const postStatusRepository = yield* PostStatusRepository;
          const jwtSecretRepository = yield* JwtSecretRepository;
          const attributeDefinitionRepository =
            yield* AttributeDefinitionRepository;
          const postRepository = yield* PostRepository;

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

          const { sanitizedMarkdown: sanitizedContent, sanitizedHtml } =
            sanitizeMarkdown(content);
          const id = yield* PostId.generate;
          const now = new Date();
          const excerpt = htmlToExcerpt(sanitizedHtml);
          const slug = slugify(title);

          let contactId: string | undefined;

          if (token) {
            const secrets = yield* jwtSecretRepository.getSecretsForOrg({
              organizationId,
            });

            if (secrets.length === 0) {
              return yield* new UnauthorizedError({
                message: "Organization has no JWT secret configured",
              });
            }

            const contactDefs =
              (yield* attributeDefinitionRepository.findContactAttributeDefinitions(
                organizationId
              )) as unknown as readonly TContactAttributeDefinition[];
            const companyDefs =
              (yield* attributeDefinitionRepository.findCompanyAttributeDefinitions(
                organizationId
              )) as unknown as readonly TCompanyAttributeDefinition[];

            const jwtPayload = yield* verifyJwt(
              token,
              secrets.map((s) => s.secret)
            );

            const parsedContact = yield* parsePersonAttributes(
              jwtPayload,
              contactDefs,
              companyDefs
            );

            yield* transaction(
              Effect.gen(function* () {
                contactId = yield* upsertContactFromParsed(
                  organizationId,
                  parsedContact
                ).pipe(
                  Effect.mapError(
                    () =>
                      new InternalServerError({
                        message: "Failed to create feedback contact",
                      })
                  )
                );

                yield* postRepository.create({
                  id,
                  boardId,
                  organizationId,
                  title,
                  content: sanitizedContent,
                  statusId: defaultStatus.id,
                  excerpt,
                  contactId: contactId ?? null,
                  metadata: metadata ?? {},
                  source: "WIDGET",
                });
              })
            );
          } else {
            yield* transaction(
              postRepository.create({
                id,
                boardId,
                organizationId,
                title,
                content: sanitizedContent,
                statusId: defaultStatus.id,
                excerpt,
                contactId: null,
                metadata: metadata ?? {},
                source: "WIDGET",
              })
            );
          }

          yield* schedulePostEmbeddingBestEffort({
            content: sanitizedContent,
            postId: id,
            organizationId,
            title,
          });

          return {
            id,
            slug,
            title,
            boardId,
            organizationId,
            createdAt: now,
          };
        }).pipe(
          Effect.provide([
            AttributeDefinitionRepository.layer,
            BoardRepository.layer,
            CompanyRepository.layer,
            ContactRepository.layer,
            JwtSecretRepository.layer,
            PostRepository.layer,
            PostStatusRepository.layer,
          ]),
          withRemapDbErrors("Feedback", "create")
        )
      )
);
