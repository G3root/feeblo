import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { secureBlankTarget } from "./html-sanitizer";

describe("HtmlSanitizer", () => {
  it("secures uppercase blank targets while preserving existing rel tokens", () => {
    const document = new Window().document;
    const link = document.createElement("a");
    link.setAttribute("target", "_BLANK");
    link.setAttribute("rel", "opener nofollow");

    secureBlankTarget(link);

    expect(link.getAttribute("rel")).toBe(
      "opener nofollow noopener noreferrer"
    );
  });
});
