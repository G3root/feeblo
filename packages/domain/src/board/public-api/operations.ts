import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { BoardRepository } from "../../board/repository";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { PublicApiConfig } from "../../public-api/config";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import {
  InternalError,
  InvalidRequestError,
  NotFoundError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { PublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { withRemapDbErrors } from "../../rpc-errors";
import { toBoardSource, toPublicApiBoard } from "./mappers";
import {
  GetBoardInput,
  ListBoardsInput,
  PublicApiBoard,
  PublicApiBoardPage,
} from "./schema";

/** The read vocabulary: a board read cannot collide with anything. */
const BOARD_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * The board operations.
 *
 * A board is what a post is filed under, so a caller that creates posts needs
 * the board ids and slugs before it can name one. The endpoints are read-only:
 * board administration stays in the dashboard, where it is a member's decision
 * about the workspace's public surfaces, not a machine credential's.
 *
 * The scope is `boards.read`, which every key already receives, so these
 * endpoints are additive to existing keys rather than a new grant.
 */
export const listBoardsOperation = defineOperation(
  "listBoards",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the workspace's boards, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it.",
    failure: BOARD_READ_FAILURES,
    input: ListBoardsInput,
    output: PublicApiBoardPage,
    scope: "boards.read",
  },
  ({ cursor, limit }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const config = yield* PublicApiConfig;
      const boards = yield* BoardRepository;

      const after = yield* decodeCursorOrFail(cursor);
      const pageSize = limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT;

      const rows = yield* boards
        .findPage({
          after,
          limit: pageSize,
          organizationId: caller.organizationId,
        })
        .pipe(
          withRemapDbErrors("PublicApiBoard", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows.at(-1);

      return {
        data: pageRows.map((row) =>
          toPublicApiBoard(toBoardSource(row), {
            appUrl: config.appUrl,
            organizationId: caller.organizationId,
          })
        ),
        nextCursor:
          hasMore && lastRow !== undefined
            ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
            : null,
      };
    })
);

export const getBoardOperation = defineOperation(
  "getBoard",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "Read one board by id. A board of another workspace is reported as not found rather than forbidden, so an id cannot be used to probe another workspace.",
    failure: BOARD_READ_FAILURES,
    input: GetBoardInput,
    output: PublicApiBoard,
    scope: "boards.read",
  },
  ({ boardId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const config = yield* PublicApiConfig;
      const boards = yield* BoardRepository;

      const board = yield* boards
        .findByIdInOrganization({
          id: boardId,
          organizationId: caller.organizationId,
        })
        .pipe(
          withRemapDbErrors("PublicApiBoard", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return yield* Option.match(board, {
        onNone: () => Effect.fail(notFoundError("Board not found.")),
        onSome: (found) =>
          Effect.succeed(
            toPublicApiBoard(toBoardSource(found), {
              appUrl: config.appUrl,
              organizationId: caller.organizationId,
            })
          ),
      });
    })
);

export const boardOperations = [
  listBoardsOperation,
  getBoardOperation,
] as const;
