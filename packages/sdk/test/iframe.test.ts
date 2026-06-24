import { describe, expect, it } from "vitest";
import { createIframe, iframeOrigin, resolveBaseUrl } from "../src/iframe";

describe("resolveBaseUrl", () => {
  it("uses options.baseUrl when provided", () => {
    const result = resolveBaseUrl({ baseUrl: "https://custom.example.com" });
    expect(result).toBe("https://custom.example.com");
  });

  it("resolves to localhost when hostname is localhost", () => {
    const result = resolveBaseUrl({});
    expect(result).toMatch(/^http:\/\/localhost/);
  });
});

describe("createIframe", () => {
  it("creates an iframe element with the organization ID in the src", () => {
    const iframe = createIframe("org_test", {});

    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.src).toContain("org_test");
  });

  it("includes theme query param when provided", () => {
    const iframe = createIframe("org_test", { theme: "dark" });

    expect(iframe.src).toContain("theme=dark");
  });

  it("sets default iframe styles", () => {
    const iframe = createIframe("org_test", {});

    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("100%");
    expect(iframe.style.border).toMatch(/none/);
  });

  it("sets clipboard-write allow attribute", () => {
    const iframe = createIframe("org_test", {});

    expect(iframe.getAttribute("allow")).toBe("clipboard-write");
  });

  it("uses custom baseUrl in the iframe src", () => {
    const iframe = createIframe("org_test", {
      baseUrl: "https://staging.feeblo.com",
    });

    expect(iframe.src).toContain("staging.feeblo.com");
  });
});

describe("iframeOrigin", () => {
  it("extracts the origin from the iframe src", () => {
    const iframe = createIframe("org_test", {
      baseUrl: "https://app.feeblo.com",
    });

    const origin = iframeOrigin(iframe);
    expect(origin).toBe("https://app.feeblo.com");
  });
});
