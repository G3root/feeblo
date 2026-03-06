import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
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
  HttpApiSchema.annotations({ status: 404, identifier: "BoardNotFoundError" })
) {}

export class FailedToCreateBoardError extends Schema.TaggedError<FailedToCreateBoardError>()(
  "FailedToCreateBoardError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreateBoardError",
  })
) {}

export class FailedToUpdateBoardError extends Schema.TaggedError<FailedToUpdateBoardError>()(
  "FailedToUpdateBoardError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToUpdateBoardError",
  })
) {}

export class FailedToDeleteBoardError extends Schema.TaggedError<FailedToDeleteBoardError>()(
  "FailedToDeleteBoardError",
  {},
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToDeleteBoardError",
  })
) {}

export const BoardServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  BoardNotFoundError,
  FailedToCreateBoardError,
  FailedToUpdateBoardError,
  FailedToDeleteBoardError,
  BadRequestError
);
