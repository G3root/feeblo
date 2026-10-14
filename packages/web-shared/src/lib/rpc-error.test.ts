import * as Cause from "effect/Cause";
import { describe, expect, it } from "vitest";

import { isRpcErrorTag, parseRpcError, RpcError } from "./rpc-error";

/**
 * `parseRpcError` is an allowlist: only tags that carry copy an end user needs
 * keep their message, and everything else falls back to generic copy so an
 * internal error never leaks to the UI. The tests below pin both halves,
 * including the three on-behalf identity failures whose messages were being
 * discarded before this file existed.
 */

/** Wire shape of a decoded tagged failure, mirroring `UserFacingErrorSchema`. */
type DecodedTaggedError = {
  _tag: string;
  message?: string;
  reason?: string;
};

const failureCause = (error: DecodedTaggedError | Error) => Cause.fail(error);

describe("parseRpcError", () => {
  it.each([
    "SubjectNotFoundError",
    "InvalidSubjectError",
    "CrmEntryLimitReachedError",
  ])("keeps the message of the identity failure %s", (tag) => {
    const parsed = parseRpcError(
      failureCause({ _tag: tag, message: `${tag} copy` })
    );

    expect(parsed).toEqual({
      cause: expect.anything(),
      kind: "rpc",
      message: `${tag} copy`,
    });
  });

  it("keeps the plan reason of a CRM-entry refusal", () => {
    // The resolver translates the entitlement policy's `PolicyDenied` into
    // `CrmEntryLimitReachedError` carrying the policy's reason, which names
    // the plan and the cap instead of speaking about a "CRM entry".
    const parsed = parseRpcError(
      failureCause({
        _tag: "CrmEntryLimitReachedError",
        message: "The free plan allows up to 10 CRM entries.",
      })
    );

    expect(parsed.message).toBe("The free plan allows up to 10 CRM entries.");
  });

  it("prefers reason over message for an allowed tag", () => {
    const parsed = parseRpcError(
      failureCause({
        _tag: "PolicyDenied",
        message: "fallback",
        reason: "You are not allowed to post to this board.",
      })
    );

    expect(parsed.message).toBe("You are not allowed to post to this board.");
  });

  it("falls back for a tag outside the allowlist", () => {
    const parsed = parseRpcError(
      failureCause({ _tag: "InternalServerError", message: "connection reset" })
    );

    expect(parsed.message).toBe("Something went wrong. Please try again.");
  });

  it("falls back for an error that carries no tag", () => {
    const parsed = parseRpcError(failureCause(new Error("boom")));

    expect(parsed.message).toBe("Something went wrong. Please try again.");
  });

  it("unwraps a tagged failure thrown as an RpcError", () => {
    const parsed = parseRpcError(
      new RpcError(
        failureCause({
          _tag: "CrmEntryLimitReachedError",
          message: "no room",
        })
      )
    );

    expect(parsed.message).toBe("no room");
  });
});

describe("isRpcErrorTag", () => {
  it("matches a decoded tagged failure", () => {
    expect(
      isRpcErrorTag(
        new RpcError(
          failureCause({ _tag: "CrmEntryLimitReachedError", message: "x" })
        ),
        "CrmEntryLimitReachedError"
      )
    ).toBe(true);
  });

  it("rejects a different tag", () => {
    expect(
      isRpcErrorTag(
        new RpcError(failureCause({ _tag: "PolicyDenied", reason: "x" })),
        "CrmEntryLimitReachedError"
      )
    ).toBe(false);
  });

  it("rejects a plain value", () => {
    expect(isRpcErrorTag(new Error("boom"), "PolicyDenied")).toBe(false);
  });
});
