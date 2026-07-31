import * as Cause from "effect/Cause";
import { describe, expect, it } from "vitest";

import { parseRpcError, RpcError } from "./rpc-error";

describe("parseRpcError", () => {
  it("preserves the cause without parsing declared domain errors", () => {
    const cause = Cause.fail({
      _tag: "BoardNotFoundError",
      message: "Board not found",
    });
    const error = new RpcError(cause);

    expect(parseRpcError(error)).toEqual({
      cause,
      kind: "rpc",
      message: "Something went wrong. Please try again.",
    });
  });

  it("uses supplied safe fallback copy for an unhandled RPC cause", () => {
    const cause = Cause.fail({ _tag: "RateLimitExceededError" });

    expect(parseRpcError(cause, "Please wait and try again.")).toEqual({
      cause,
      kind: "rpc",
      message: "Please wait and try again.",
    });
  });

  it("does not expose unexpected thrown values", () => {
    expect(parseRpcError(new Error("database credentials"))).toEqual({
      kind: "unexpected",
      message: "Something went wrong. Please try again.",
    });
  });
});
