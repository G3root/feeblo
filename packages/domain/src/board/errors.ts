import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

export class BoardNotFoundError extends Schema.TaggedError<BoardNotFoundError>()(
  "BoardNotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({ status: 404, identifier: "BoardNotFoundError" })
) {}

export class FailedToCreateBoardError extends Schema.TaggedError<FailedToCreateBoardError>()(
  "FailedToCreateBoardError",
  {
    message: Schema.optional(Schema.String),
  },
  HttpApiSchema.annotations({
    status: 500,
    identifier: "FailedToCreateBoardError",
  })
) {}

export const BoardServiceErrors = Schema.Union(
  UnauthorizedError,
  InternalServerError,
  BoardNotFoundError,
  FailedToCreateBoardError
);
