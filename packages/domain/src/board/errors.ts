import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class BoardNotFoundError extends Schema.TaggedError<BoardNotFoundError>()(
  "BoardNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "BoardNotFoundError" }
) {}

export class FailedToCreateBoardError extends Schema.TaggedError<FailedToCreateBoardError>()(
  "FailedToCreateBoardError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateBoardError" }
) {}

export class FailedToUpdateBoardError extends Schema.TaggedError<FailedToUpdateBoardError>()(
  "FailedToUpdateBoardError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateBoardError" }
) {}

export class FailedToDeleteBoardError extends Schema.TaggedError<FailedToDeleteBoardError>()(
  "FailedToDeleteBoardError",
  {},
  { httpApiStatus: 500, identifier: "FailedToDeleteBoardError" }
) {}

export const BoardServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BoardNotFoundError,
  FailedToCreateBoardError,
  FailedToUpdateBoardError,
  FailedToDeleteBoardError,
  BadRequestError,
]);
