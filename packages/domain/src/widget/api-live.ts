import { transaction } from "@feeblo/db";
import { PostId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { BoardRepository } from "../board/repository";
import { DataValidationError } from "../contact/errors";
import { ContactRepository } from "../contact/repository";
import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../contact/schema";
import type { ParsedPersonAttributes } from "../contact/utils";
import { parsePersonAttributes } from "../contact/utils";
import { Api } from "../http/api";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { verifyJwt } from "../jwt-secret/verification";
import { PostRepository } from "../post/repository";
import { PostStatusRepository } from "../post-status/repository";
import {
  InternalServerError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";

export const WidgetApiLive = HttpApiBuilder.group(
  Api,
  "WidgetApiGroup",
  (handlers) =>
    handlers
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
          Effect.catchIf(
            (e) =>
              Predicate.isTagged(e, "EffectDrizzleQueryError") ||
              Predicate.isTagged(e, "SqlError"),
            () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list boards" })
              )
          )
        )
      )
      .handle("createFeedback", ({ payload }) =>
        Effect.gen(function* () {
          const { boardId, organizationId, title, content, token } = payload;

          const boardRepository = yield* BoardRepository;
          const postStatusRepository = yield* PostStatusRepository;
          const jwtSecretRepository = yield* JwtSecretRepository;
          const contactRepository = yield* ContactRepository;
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

          let parsedContact: ParsedPersonAttributes | undefined;

          if (token) {
            const secrets = yield* jwtSecretRepository.getSecretsForOrg({
              organizationId,
            });

            if (secrets.length > 0) {
              const jwtPayload = yield* verifyJwt(
                token,
                secrets.map((s) => s.secret)
              );

              const contactDefs =
                (yield* contactRepository.findContactAttributeDefinitions(
                  organizationId
                )) as unknown as readonly TContactAttributeDefinition[];
              const companyDefs =
                (yield* contactRepository.findCompanyAttributeDefinitions(
                  organizationId
                )) as unknown as readonly TCompanyAttributeDefinition[];

              parsedContact = yield* parsePersonAttributes(
                jwtPayload,
                contactDefs,
                companyDefs
              );
            }
          }

          yield* transaction(
            Effect.gen(function* () {
              let contactId: string | undefined;

              if (parsedContact) {
                let linkedCompanyId: string | undefined;

                for (const company of parsedContact.companies) {
                  const upsertedCompany =
                    yield* contactRepository.upsertCompany({
                      organizationId,
                      externalId: company.commonFields.id,
                      name: company.commonFields.name,
                    });
                  linkedCompanyId = upsertedCompany.id;

                  for (const attr of company.customAttributes) {
                    yield* contactRepository.upsertCompanyAttributeValue({
                      companyId: upsertedCompany.id,
                      attributeId: attr.definitionId,
                      value: attr.value,
                    });
                  }
                }

                const contactOption = yield* contactRepository.upsertContact({
                  organizationId,
                  externalId: parsedContact.commonFields.userId,
                  email: parsedContact.commonFields.email,
                  name: parsedContact.commonFields.name,
                  companyId: linkedCompanyId ?? null,
                });

                if (Option.isSome(contactOption)) {
                  contactId = contactOption.value.id;

                  for (const attr of parsedContact.customAttributes) {
                    yield* contactRepository.upsertContactAttributeValue({
                      contactId: contactOption.value.id,
                      attributeId: attr.definitionId,
                      value: attr.value,
                    });
                  }
                }
              }

              yield* postRepository.create({
                id,
                boardId,
                organizationId,
                title,
                content: sanitizedContent,
                statusId: defaultStatus.id,
                excerpt,
                contactId: contactId ?? null,
                source: "WIDGET",
              });
            })
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
          Effect.provide([
            BoardRepository.layer,
            ContactRepository.layer,
            JwtSecretRepository.layer,
            PostRepository.layer,
            PostStatusRepository.layer,
          ]),
          withRemapDbErrors("Feedback", "create")
        )
      )
);
