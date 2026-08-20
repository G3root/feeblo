import * as Cause from "effect/Cause";
import { describe, expect, it } from "vitest";

import { parseRpcError, RpcError } from "./rpc-error";

describe("parseRpcError", () => {
  it("extracts user-facing message from domain errors", () => {
    const cause = Cause.fail({
      _tag: "BoardNotFoundError",
      message: "Board not found",
    });
    const error = new RpcError(cause);

    expect(parseRpcError(error)).toEqual({
      cause,
      kind: "rpc",
      message: "Board not found",
    });
  });

  it("extracts PolicyDenied reason", () => {
    const cause = Cause.fail({
      _tag: "PolicyDenied",
      reason: "The free plan allows up to 10 CRM entries.",
    });
    const error = new RpcError(cause);

    expect(parseRpcError(error)).toEqual({
      cause,
      kind: "rpc",
      message: "The free plan allows up to 10 CRM entries.",
    });
  });

  it("hides internal server errors", () => {
    const cause = Cause.fail({
      _tag: "InternalServerError",
      message: "Error creating Contact",
    });
    expect(parseRpcError(cause)).toEqual({
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

  it("hides sensitive details from unlisted tags", () => {
    const cause = Cause.fail({
      _tag: "SecretInternalError",
      reason: "database credentials leak: postgres://secret",
      message: "sensitive internal stack trace",
    });
    expect(parseRpcError(cause)).toEqual({
      cause,
      kind: "rpc",
      message: "Something went wrong. Please try again.",
    });
    const sqlCause = Cause.fail({
      _tag: "SqlError",
      reason: "SQLSTATE 42P01: relation secret_table",
    });
    expect(parseRpcError(sqlCause, "Fallback message")).toEqual({
      cause: sqlCause,
      kind: "rpc",
      message: "Fallback message",
    });
  });
});
