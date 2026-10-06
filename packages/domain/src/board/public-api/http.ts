import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiBoardGroup } from "../../public-api/api-contract";
import { PUBLIC_API_ERROR_SCHEMAS } from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit } from "../../public-api/parse";
import { getBoardOperation, listBoardsOperation } from "./operations";
import {
  GetBoardParams,
  ListBoardsQuery,
  PublicApiBoard,
  PublicApiBoardPage,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiBoardGroup>;

/**
 * The board endpoints, and their HTTP implementations.
 *
 * The declarations are the published contract — paths, parameters, statuses,
 * and OpenAPI prose — and the handlers do only the HTTP-specific work: parsing
 * string query parameters, then delegating to the operation. Business behavior
 * lives in `./operations.ts`, so the MCP projection calls the same code without
 * an HTTP request in between.
 */

export const boardEndpoints = [
  HttpApiEndpoint.get("listBoards", "/boards", {
    query: ListBoardsQuery,
    success: PublicApiBoardPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Boards")
    .annotate(OpenApi.Summary, "List the workspace's boards")
    .annotate(
      OpenApi.Description,
      "Returns the boards of the calling workspace, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it. Use this to resolve the board a post is filed under before creating one."
    ),
  HttpApiEndpoint.get("getBoard", "/boards/:boardId", {
    params: GetBoardParams,
    success: PublicApiBoard,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Board")
    .annotate(OpenApi.Summary, "Get a board")
    .annotate(
      OpenApi.Description,
      "Returns one board. Boards of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
] as const;

export const boardHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listBoards: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listBoardsOperation.handler({
        cursor: query.cursor,
        limit,
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listBoards",
    PublicApiCaller
  >,

  getBoard: (({ params }) =>
    getBoardOperation
      .handler({ boardId: params.boardId })
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "getBoard",
    PublicApiCaller
  >,
});
