import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { PostAlreadyExistsError } from "./post/errors";
import { withRemapDbErrors } from "./rpc-errors";

describe("withRemapDbErrors", () => {
  it("maps unique violations to a meaningful safe message", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: ["secret-param"],
            cause: {
              code: "23505",
              constraint: "post_organizationId_boardId_slug_uidx",
            },
          })
        ).pipe(
          withRemapDbErrors("Post", "create", undefined, {
            uniqueViolationMessage: "A post with this slug already exists",
          })
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "InternalServerError",
      message: "A post with this slug already exists",
    });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("post_organizationId");
  });

  it("allows the caller to return a typed unique violation error", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
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
      )
    );

    expect(error).toEqual(
      new PostAlreadyExistsError({
        message: "A post with this slug already exists",
      })
    );
    expect(error).not.toHaveProperty("cause");
  });

  it("does not expose the database error in the public error", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.fail(
          new EffectDrizzleQueryError({
            query: 'insert into "post" ...',
            params: ["secret-param"],
            cause: new Error("database credentials and query details"),
          })
        ).pipe(withRemapDbErrors("Post", "create"))
      )
    );

    expect(error).toMatchObject({
      _tag: "InternalServerError",
      message: "Error createing Post",
      detail: "There was a database error when the Post",
    });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("secret-param");
    expect(JSON.stringify(error)).not.toContain("database credentials");
  });
});
