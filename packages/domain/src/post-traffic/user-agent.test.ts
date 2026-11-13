import { describe, expect, it } from "@effect/vitest";

import { parseUserAgent } from "./user-agent";

const CHROME_MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("parseUserAgent", () => {
  it("reads the desktop Chrome agent when the browser proves desktop", () => {
    expect(parseUserAgent(CHROME_MACOS, "desktop")).toEqual({
      browser: "Chrome",
      device: "desktop",
      os: "macOS",
    });
  });

  it("does not call an unhinted Macintosh agent desktop", () => {
    // iPadOS 13+ reports a Macintosh agent, so desktop would be a guess.
    expect(parseUserAgent(CHROME_MACOS).device).toBe("unknown");
  });

  it("lets the browser's device hint settle the ambiguity", () => {
    expect(parseUserAgent(CHROME_MACOS, "tablet").device).toBe("tablet");
  });

  it("keeps Safari distinct from Chrome", () => {
    expect(parseUserAgent(SAFARI_IOS)).toEqual({
      browser: "Safari",
      device: "mobile",
      os: "iOS",
    });
  });

  it("reads Android as Android, not Linux", () => {
    expect(parseUserAgent(CHROME_ANDROID)).toEqual({
      browser: "Chrome",
      device: "mobile",
      os: "Android",
    });
  });

  it("checks Edge before the Chrome it impersonates", () => {
    expect(parseUserAgent(EDGE_WINDOWS).browser).toBe("Edge");
  });

  it("reads Firefox", () => {
    expect(parseUserAgent(FIREFOX_WINDOWS)).toEqual({
      browser: "Firefox",
      device: "desktop",
      os: "Windows",
    });
  });

  it("reads an iPad as a tablet, not a phone", () => {
    expect(parseUserAgent(IPAD).device).toBe("tablet");
  });

  it("reads desktop Linux", () => {
    expect(parseUserAgent(CHROME_LINUX)).toEqual({
      browser: "Chrome",
      device: "desktop",
      os: "Linux",
    });
  });

  it("is total: an empty agent is Other", () => {
    expect(parseUserAgent("")).toEqual({
      browser: "Other",
      device: "unknown",
      os: "Other",
    });
  });

  it("is total: an unknown agent is Other", () => {
    expect(parseUserAgent("SomethingElse/1.0 (fictional)")).toEqual({
      browser: "Other",
      device: "desktop",
      os: "Other",
    });
  });
});
