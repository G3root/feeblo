import { Schema } from "effect";
import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

export class BoardNotFoundError extends Schema.TaggedErrorClass<BoardNotFoundError>()(
  "BoardNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "BoardNotFoundError" }
) {}

export class FailedToCreateBoardError extends Schema.TaggedErrorClass<FailedToCreateBoardError>()(
  "FailedToCreateBoardError",
  {},
  { httpApiStatus: 500, identifier: "FailedToCreateBoardError" }
) {}

export class FailedToUpdateBoardError extends Schema.TaggedErrorClass<FailedToUpdateBoardError>()(
  "FailedToUpdateBoardError",
  {},
  { httpApiStatus: 500, identifier: "FailedToUpdateBoardError" }
) {}

export class FailedToDeleteBoardError extends Schema.TaggedErrorClass<FailedToDeleteBoardError>()(
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
