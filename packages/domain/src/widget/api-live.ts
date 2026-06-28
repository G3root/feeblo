import { Database, schema } from "@feeblo/db";
import { PostId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { BoardRepository } from "../board/repository";
import { Api } from "../http/api";
import { PostStatusRepository } from "../post-status/repository";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";

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
          Effect.catchTag("DatabaseError", () =>
            Effect.fail(
              new InternalServerError({ message: "Failed to list boards" })
            )
          )
        )
      )
      .handle("createFeedback", ({ payload }) =>
        Effect.gen(function* () {
          const { boardId, organizationId, title, content } = payload;
          const boardRepository = yield* BoardRepository;
          const postStatusRepository = yield* PostStatusRepository;
          const db = yield* Database.Database;

          const board = yield* boardRepository.getById({
            id: boardId,
            organizationId,
          });

          if (board._tag === "None") {
            return yield* new NotFoundError({ message: "Board not found" });
          }

          if (board.value.visibility !== "PUBLIC") {
            return yield* new BadRequestError({
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

          const sanitizedContent = sanitizeRichText(content);
          const id = yield* PostId.generate;
          const now = new Date();

          const created = yield* db.execute((client) =>
            client
              .insert(schema.postTable)
              .values({
                id,
                boardId,
                organizationId,
                title,
                content: sanitizedContent,
                excerpt: htmlToExcerpt(sanitizedContent),
                statusId: defaultStatus.id,
                slug: slugify(title),
                createdAt: now,
                updatedAt: now,
              })
              .returning({
                id: schema.postTable.id,
                slug: schema.postTable.slug,
                title: schema.postTable.title,
                boardId: schema.postTable.boardId,
                organizationId: schema.postTable.organizationId,
                createdAt: schema.postTable.createdAt,
              })
          );

          const row = created[0];
          if (!row) {
            return yield* new InternalServerError({
              message: "Failed to create feedback",
            });
          }

          return row;
        }).pipe(
          Effect.provide([BoardRepository.layer, PostStatusRepository.layer]),
          Effect.catchTag("DatabaseError", () =>
            Effect.fail(
              new InternalServerError({ message: "Failed to create feedback" })
            )
          ),
          Effect.catchTag("LegidError", () =>
            Effect.fail(
              new InternalServerError({ message: "Failed to create feedback" })
            )
          )
        )
      )
);
