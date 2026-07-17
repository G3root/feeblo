import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./tokens";

const withSecret = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ UNSUBSCRIBE_SECRET: "test-secret" })
    )
  );

describe("unsubscribe tokens", () => {
  it("round trips the exact resource identifier", async () => {
    const payload = {
      version: 1,
      kind: "post",
      resourceId: "psb_original",
    } as const;
    const decoded = await Effect.runPromise(
      withSecret(
        Effect.flatMap(signUnsubscribeToken(payload), verifyUnsubscribeToken)
      )
    );
    expect(decoded).toEqual(payload);
  });

  it("rejects a tampered token", async () => {
    const token = await Effect.runPromise(
      withSecret(
        signUnsubscribeToken({
          version: 1,
          kind: "digest",
          resourceId: "wnp_original",
        })
      )
    );
    const exit = await Effect.runPromiseExit(
      withSecret(verifyUnsubscribeToken(`${token.slice(0, -1)}x`))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
