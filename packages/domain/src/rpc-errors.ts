import { Effect, Predicate, Schema } from "effect";

export class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  "BadRequestError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400, identifier: "BadRequestError" }
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404, identifier: "NotFoundError" }
) {}

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.optional(Schema.String),
  },
  { httpApiStatus: 401, identifier: "UnauthorizedError" }
) {}

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  "InternalServerError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Any),
  },
  { httpApiStatus: 500, identifier: "InternalServerError" }
) {}

export function withRemapDbErrors<R, E extends { _tag: string }, A>(
  entityType: string,
  action: "update" | "create" | "delete" | "select",
  entityId?: unknown | { value: unknown; key: string }[]
) {
  return (
    effect: Effect.Effect<R, E, A>
  ): Effect.Effect<
    R,
    Exclude<E, { _tag: "DatabaseError" | "SchemaError" }> | InternalServerError,
    A
  > => {
    const toInternalError = (err: unknown, detailPrefix: string) =>
      Effect.fail(
        new InternalServerError({
          message: `Error ${action}ing ${entityType}`,
          detail: constructDetailMessage(detailPrefix, entityType, entityId),
          cause: String(err),
        })
      );

    return effect.pipe(
      Effect.catchIf(
        (e): e is Extract<E, { _tag: "DatabaseError" }> =>
          Predicate.isTagged(e, "DatabaseError"),
        (err) => toInternalError(err, "There was a database error when")
      ),
      Effect.catchIf(
        (e): e is Extract<E, { _tag: "SchemaError" }> =>
          Predicate.isTagged(e, "SchemaError"),
        (err) => toInternalError(err, "There was an error in parsing when")
      )
    ) as Effect.Effect<
      R,
      | Exclude<E, { _tag: "DatabaseError" | "SchemaError" }>
      | InternalServerError,
      A
    >;
  };
}

const constructDetailMessage = (
  title: string,
  entityType: string,
  entityId?: unknown | { value: unknown; key: string }[]
) => {
  if (entityId) {
    if (Array.isArray(entityId)) {
      return `${title} the ${entityType} with values ${entityId
        .map((value) => `${value.key}: ${value.value}`)
        .join(", ")}`;
    }
    return `${title} the ${entityType} with id ${entityId}`;
  }

  return `${title} the ${entityType}`;
};
