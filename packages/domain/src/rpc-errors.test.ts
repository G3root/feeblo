import { describe, expect, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { PostAlreadyExistsError } from "./post/errors";
import { withRemapDbErrors } from "./rpc-errors";

describe("withRemapDbErrors", () => {
  it.effect("maps unique violations to a meaningful safe message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: ["secret-param"],
            cause: {
              code: "23505",
              constraint: "post_organizationId_slug_uidx",
            },
          })
        ).pipe(
          withRemapDbErrors("Post", "create", undefined, {
            uniqueViolationMessage: "A post with this slug already exists",
          })
        )
      );

      expect(error).toMatchObject({
        _tag: "InternalServerError",
        message: "A post with this slug already exists",
      });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain("post_organizationId");
    })
  );

  it.effect("allows the caller to return a typed unique violation error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: [],
            cause: { code: "23505" },
          })
        ).pipe(
          withRemapDbErrors({
            action: "create",
            entity: "Post",
            onUniqueViolation: () =>
              new PostAlreadyExistsError({
                message: "A post with this slug already exists",
              }),
          })
        )
      );

      expect(error).toEqual(
        new PostAlreadyExistsError({
          message: "A post with this slug already exists",
        })
      );
      expect(error).not.toHaveProperty("cause");
    })
  );

  it.effect("maps unique violations wrapped in an Effect cause", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: [],
            cause: Cause.fail({ cause: { cause: { code: "23505" } } }),
          })
        ).pipe(
          withRemapDbErrors({
            action: "create",
            entity: "Post",
            onUniqueViolation: () =>
              new PostAlreadyExistsError({
                message: "A post with this slug already exists",
              }),
          })
        )
      );

      expect(error).toEqual(
        new PostAlreadyExistsError({
          message: "A post with this slug already exists",
        })
      );
    })
  );

  it.effect("does not expose the database error in the public error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: ["secret-param"],
            cause: new Error("database credentials and query details"),
          })
        ).pipe(withRemapDbErrors("Post", "create"))
      );

      expect(error).toMatchObject({
        _tag: "InternalServerError",
        message: "Error createing Post",
        detail: "There was a database error when the Post",
      });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain("secret-param");
      expect(JSON.stringify(error)).not.toContain("database credentials");
    })
  );
});
