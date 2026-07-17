import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

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

export function withRemapDbErrors<R, E, A>(
  entityType: string,
  action: "update" | "create" | "delete" | "select" | "upsert",
  entityId?: unknown | { value: unknown; key: string }[]
) {
  return (
    effect: Effect.Effect<R, E, A>
  ): Effect.Effect<
    R,
    | Exclude<
        E,
        | EffectDrizzleQueryError
        | { _tag: "SqlError" | "SchemaError" | "LegidError" }
      >
    | InternalServerError,
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
        (
          e
        ): e is Extract<
          E,
          | EffectDrizzleQueryError
          | { _tag: "SqlError" }
          | { _tag: "SchemaError" }
          | { _tag: "LegidError" }
        > =>
          e instanceof EffectDrizzleQueryError ||
          Predicate.isTagged(e, "SqlError") ||
          Predicate.isTagged(e, "SchemaError") ||
          Predicate.isTagged(e, "LegidError"),
        (err) => {
          if (Predicate.isTagged(err, "SchemaError")) {
            return toInternalError(
              err,
              "There was an error in parsing when"
            );
          }
          if (Predicate.isTagged(err, "LegidError")) {
            return toInternalError(
              err,
              "There was an error generating an id when"
            );
          }
          return toInternalError(err, "There was a database error when");
        }
      )
    );
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
