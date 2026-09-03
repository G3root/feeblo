/**
 * JSON-LD (schema.org) builders for structured data injected into HTML
 * `<script type="application/ld+json">` elements.
 *
 * Content is user-generated (site names, post titles, excerpts), so
 * {@link serializeJsonLd} escapes the HTML delimiters (`<`, `>`, `&`) as
 * unicode escapes to keep the embedded JSON inert inside a script element.
 */

/** The subset of schema.org properties this module emits. */
export interface JsonLdNode {
  readonly "@context": "https://schema.org";
  readonly "@type": string;
  readonly author?: { readonly "@type": "Person"; readonly name: string };
  readonly dateModified?: string;
  readonly datePublished?: string;
  readonly description?: string;
  readonly headline?: string;
  readonly name?: string;
  readonly url?: string;
}

export interface JsonLdWebsiteInput {
  readonly name: string;
  readonly url: string;
}

/** A `WebSite` node describing the public board as a whole. */
export function websiteJsonLd({ name, url }: JsonLdWebsiteInput): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url,
  };
}

export interface JsonLdArticleInput {
  readonly headline: string;
  readonly description: string;
  readonly url: string;
  readonly datePublished: Date;
  readonly dateModified: Date;
  /** Display name of the author, or `null` when not shown publicly. */
  readonly authorName: string | null;
}

/**
 * A `SocialMediaPosting` node for a user-created feedback post. A feedback
 * board post is user-generated content with votes and comments rather than
 * editorial content, so the Article subtype keeps a plain `Article` node from
 * implying editorial authorship.
 */
export function postJsonLd(input: JsonLdArticleInput): JsonLdNode {
  return articleJsonLd(input, "SocialMediaPosting");
}

/** An `Article` node for a changelog entry published by the team. */
export function changelogJsonLd(input: JsonLdArticleInput): JsonLdNode {
  return articleJsonLd(input, "Article");
}

function articleJsonLd(
  {
    headline,
    description,
    url,
    datePublished,
    dateModified,
    authorName,
  }: JsonLdArticleInput,
  type: "Article" | "SocialMediaPosting"
): JsonLdNode {
  const base: JsonLdNode = {
    "@context": "https://schema.org",
    "@type": type,
    headline,
    description,
    url,
    datePublished: datePublished.toISOString(),
    dateModified: dateModified.toISOString(),
  };

  if (authorName === null) {
    return base;
  }

  return { ...base, author: { "@type": "Person", name: authorName } };
}

/**
 * Serialize a JSON-LD node for embedding inside a `<script>` element. The
 * HTML delimiters are replaced with unicode escapes so `</script>`, tags, and
 * entities inside user-generated values cannot break out of the element.
 */
export function serializeJsonLd(node: JsonLdNode): string {
  return JSON.stringify(node)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}
