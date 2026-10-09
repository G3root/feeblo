import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { HttpUrl, isHttpUrl } from "./http-url";

const decode = Schema.decodeUnknownOption(HttpUrl);

describe("HttpUrl", () => {
  it("accepts http and https URLs", () => {
    for (const value of [
      "https://github.com/acme/feeblo/issues/1",
      "http://127.0.0.1:9002/media/object.png",
    ]) {
      expect(Option.isSome(decode(value))).toBe(true);
    }
  });

  it("rejects every other scheme", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(Option.isNone(decode(value))).toBe(true);
    }
  });

  it("rejects strings that are not URLs", () => {
    expect(Option.isNone(decode("not a url"))).toBe(true);
    expect(Option.isNone(decode(""))).toBe(true);
  });
});

describe("isHttpUrl", () => {
  it("matches the schema's verdict", () => {
    expect(isHttpUrl("https://example.com/issue/1")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,x")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});
