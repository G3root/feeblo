import { describe, expect, it } from "vitest";

import {
  changelogJsonLd,
  postJsonLd,
  serializeJsonLd,
  websiteJsonLd,
} from "./json-ld";

describe("websiteJsonLd", () => {
  it("describes the public board site", () => {
    expect(
      websiteJsonLd({ name: "Acme", url: "https://acme.example.com/" })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Acme",
      url: "https://acme.example.com/",
    });
  });
});

describe("postJsonLd", () => {
  it("describes a post as a SocialMediaPosting with an optional author", () => {
    const node = postJsonLd({
      headline: "Dark mode",
      description: "Add a dark theme",
      url: "https://acme.example.com/p/dark-mode",
      datePublished: new Date("2025-01-01T00:00:00Z"),
      dateModified: new Date("2025-02-01T00:00:00Z"),
      authorName: "Jane Doe",
    });

    expect(node["@type"]).toBe("SocialMediaPosting");
    expect(node).toMatchObject({
      headline: "Dark mode",
      datePublished: "2025-01-01T00:00:00.000Z",
      dateModified: "2025-02-01T00:00:00.000Z",
      author: { "@type": "Person", name: "Jane Doe" },
    });

    const anonymous = postJsonLd({
      headline: "Dark mode",
      description: "Add a dark theme",
      url: "https://acme.example.com/p/dark-mode",
      datePublished: new Date("2025-01-01T00:00:00Z"),
      dateModified: new Date("2025-02-01T00:00:00Z"),
      authorName: null,
    });

    expect(anonymous).not.toHaveProperty("author");
  });
});

describe("changelogJsonLd", () => {
  it("describes a changelog entry as an Article", () => {
    const node = changelogJsonLd({
      headline: "v2 released",
      description: "Everything new in v2",
      url: "https://acme.example.com/changelog/v2",
      datePublished: new Date("2025-01-01T00:00:00Z"),
      dateModified: new Date("2025-01-01T00:00:00Z"),
      authorName: null,
    });

    expect(node["@type"]).toBe("Article");
  });
});

describe("serializeJsonLd", () => {
  it("escapes HTML delimiters so embedded values stay inert", () => {
    const node = postJsonLd({
      headline: `</script><img src=x onerror=alert(1)>&`,
      description: "description",
      url: "https://acme.example.com/p/dark-mode",
      datePublished: new Date("2025-01-01T00:00:00Z"),
      dateModified: new Date("2025-01-01T00:00:00Z"),
      authorName: null,
    });

    expect(serializeJsonLd(node)).toBe(
      '{"@context":"https://schema.org","@type":"SocialMediaPosting","headline":"\\u003c/script\\u003e\\u003cimg src=x onerror=alert(1)\\u003e\\u0026","description":"description","url":"https://acme.example.com/p/dark-mode","datePublished":"2025-01-01T00:00:00.000Z","dateModified":"2025-01-01T00:00:00.000Z"}'
    );
  });

  it("round-trips through JSON.parse", () => {
    const node = websiteJsonLd({
      name: "a<b>c&d",
      url: "https://acme.example.com/",
    });

    expect(JSON.parse(serializeJsonLd(node))).toEqual(node);
  });
});
