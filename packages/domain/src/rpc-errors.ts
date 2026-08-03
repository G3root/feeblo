import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const DatabaseDriverError = Schema.Struct({
  code: Schema.String,
});

const DatabaseCauseFailure = Schema.TaggedStruct("Fail", {
  error: DatabaseDriverError,
});

const DatabaseSqlError = Schema.Struct({
  cause: Schema.Struct({
    cause: DatabaseDriverError,
  }),
});

const DatabaseSqlCauseFailure = Schema.TaggedStruct("Fail", {
  error: DatabaseSqlError,
});

const DatabaseErrorCause = Schema.Struct({
  "~effect/Cause": Schema.Literal("~effect/Cause"),
  reasons: Schema.Array(DatabaseCauseFailure),
});

const DatabaseSqlErrorCause = Schema.Struct({
  "~effect/Cause": Schema.Literal("~effect/Cause"),
  reasons: Schema.Array(DatabaseSqlCauseFailure),
});

const getDatabaseErrorCode = (cause: unknown): string | undefined =>
  Option.match(Schema.decodeUnknownOption(DatabaseDriverError)(cause), {
    onNone: () =>
      Option.match(Schema.decodeUnknownOption(DatabaseErrorCause)(cause), {
        onNone: () =>
          Option.match(
            Schema.decodeUnknownOption(DatabaseSqlErrorCause)(cause),
            {
              onNone: () => undefined,
              onSome: ({ reasons }) => reasons[0]?.error.cause.cause.code,
            }
          ),
        onSome: ({ reasons }) => reasons[0]?.error.code,
      }),
    onSome: ({ code }) => code,
  });

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof EffectDrizzleQueryError &&
  getDatabaseErrorCode(error.cause) === "23505";

type DbAction = "update" | "create" | "delete" | "select" | "upsert";

export type RemapDbErrorsOptions = {
  readonly uniqueViolationMessage?: string;
};

export type RemapDbErrorsConfig<UniqueViolationError = never> = {
  readonly entity: string;
  readonly action: DbAction;
  readonly entityId?: unknown | { value: unknown; key: string }[];
  readonly onUniqueViolation?: () => UniqueViolationError;
  readonly uniqueViolationMessage?: string;
};

type RemappedDbError =
  | EffectDrizzleQueryError
  | { _tag: "SqlError" | "SchemaError" | "LegidError" };

type RemappedDbEffect<R, E, A, UniqueViolationError> = Effect.Effect<
  R,
  Exclude<E, RemappedDbError> | InternalServerError | UniqueViolationError,
  A
>;

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
  },
  { httpApiStatus: 500, identifier: "InternalServerError" }
) {}

export function withRemapDbErrors<R, E, A, UniqueViolationError = never>(
  config: RemapDbErrorsConfig<UniqueViolationError>
): (
  effect: Effect.Effect<R, E, A>
) => RemappedDbEffect<R, E, A, UniqueViolationError>;
export function withRemapDbErrors<R, E, A>(
  entityType: string,
  action: DbAction,
  entityId?: unknown | { value: unknown; key: string }[],
  options?: RemapDbErrorsOptions
): (effect: Effect.Effect<R, E, A>) => RemappedDbEffect<R, E, A, never>;
export function withRemapDbErrors<R, E, A, UniqueViolationError = never>(
  entityOrConfig: string | RemapDbErrorsConfig<UniqueViolationError>,
  action?: DbAction,
  entityId?: unknown | { value: unknown; key: string }[],
  options?: RemapDbErrorsOptions
) {
  let config: RemapDbErrorsConfig<UniqueViolationError>;
  if (typeof entityOrConfig === "string") {
    if (action === undefined) {
      throw new TypeError("withRemapDbErrors requires a database action");
    }
    config = {
      action,
      entity: entityOrConfig,
      ...(entityId === undefined ? {} : { entityId }),
      ...(options?.uniqueViolationMessage === undefined
        ? {}
        : { uniqueViolationMessage: options.uniqueViolationMessage }),
    };
  } else {
    config = entityOrConfig;
  }

  return (
    effect: Effect.Effect<R, E, A>
  ): RemappedDbEffect<R, E, A, UniqueViolationError> => {
    const toInternalError = (
      detailPrefix: string
    ): Effect.Effect<never, InternalServerError, never> =>
      Effect.fail(
        new InternalServerError({
          message: `Error ${config.action}ing ${config.entity}`,
          detail: constructDetailMessage(
            detailPrefix,
            config.entity,
            config.entityId
          ),
        })
      );

    const toUniqueViolationError = (): Effect.Effect<
      never,
      InternalServerError | UniqueViolationError,
      never
    > =>
      config.onUniqueViolation
        ? Effect.fail(config.onUniqueViolation())
        : Effect.fail(
            new InternalServerError({
              message:
                config.uniqueViolationMessage ??
                `A ${config.entity.toLowerCase()} already exists`,
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
            return toInternalError("There was an error in parsing when");
          }
          if (Predicate.isTagged(err, "LegidError")) {
            return toInternalError("There was an error generating an id when");
          }
          if (isUniqueViolation(err)) {
            return toUniqueViolationError();
          }
          return toInternalError("There was a database error when");
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
