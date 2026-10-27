import { describe, expect, it } from "vitest";

import { automaticBrowserCapture, firstPartyFailure } from "./browser-errors";
import { errorType, strippedUrl } from "./error-reporting";

const scripts = "https://app.example.com/assets/";

const errorWithStack = (stack: string): Error => {
  const error = new Error("boom");
  error.stack = stack;
  return error;
};

/**
 * A page-level handler sees failures from extensions and injected scripts.
 * These tests pin the two halves: our own chunks are reported, and a failure
 * whose innermost located frame belongs to somebody else is not.
 */
describe("firstPartyFailure", () => {
  it("keeps an Error raised inside one of our chunks", () => {
    expect(
      firstPartyFailure(
        errorWithStack(
          "Error: boom\n    at handler (https://app.example.com/assets/index-1.js:1:2)"
        ),
        scripts
      )
    ).toBe(true);
  });

  it("drops an Error whose thrower is an extension", () => {
    expect(
      firstPartyFailure(
        errorWithStack(
          "Error: boom\n    at inject (chrome-extension://abc/inject.js:3:4)\n    at handler (https://app.example.com/assets/index-1.js:1:2)"
        ),
        scripts
      )
    ).toBe(false);
  });

  it("attributes eval code to the script that compiled it", () => {
    expect(
      firstPartyFailure(
        errorWithStack(
          "Error: boom\n    at eval (eval at run (https://app.example.com/assets/index-1.js:2:3), <anonymous>:1:1)"
        ),
        scripts
      )
    ).toBe(true);
  });

  it("keeps a frame-less Error: the browser raised it for one of our own loads", () => {
    expect(firstPartyFailure(errorWithStack("Error: boom"), scripts)).toBe(
      true
    );
  });

  it("does not attribute a thrown non-Error value", () => {
    expect(firstPartyFailure("boom", scripts)).toBe(false);
  });
});

describe("automaticBrowserCapture", () => {
  it("recognizes a page-wide handler capture", () => {
    expect(
      automaticBrowserCapture({
        exception: {
          values: [{ mechanism: { type: "auto.browser.global_handlers" } }],
        },
      })
    ).toBe(true);
  });

  it("leaves an explicit capture alone", () => {
    expect(
      automaticBrowserCapture({
        exception: { values: [{ mechanism: { type: "generic" } }] },
      })
    ).toBe(false);
    expect(automaticBrowserCapture({})).toBe(false);
  });
});

describe("errorType", () => {
  it("uses a tagged failure's tag", () => {
    expect(errorType({ _tag: "PolicyDenied" })).toBe("PolicyDenied");
  });

  it("falls back to the Error name", () => {
    expect(errorType(new TypeError("nope"))).toBe("TypeError");
  });

  it("bounds an unusable value to UnknownError", () => {
    expect(errorType({ _tag: "not a valid tag!" })).toBe("UnknownError");
    expect(errorType("boom")).toBe("UnknownError");
  });
});

describe("strippedUrl", () => {
  it("removes the query and fragment that carry invitation and OAuth values", () => {
    expect(
      strippedUrl(
        "https://app.example.com/invite/abc?token=secret#access_token=xyz"
      )
    ).toBe("https://app.example.com/invite/abc");
  });

  it("keeps a relative path relative", () => {
    expect(strippedUrl("/rpc?method=ListPosts")).toBe("/rpc");
  });

  it("treats a non-absolute value as a relative path", () => {
    expect(strippedUrl("not a url")).toBe("/not%20a%20url");
  });
});
