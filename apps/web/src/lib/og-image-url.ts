/**
 * The OG image URL a public board page advertises.
 *
 * The renderer identifies the board by id and the page by `type`; it reads the
 * site's name, and a post's title and upvotes, from the database itself. That
 * is why the URL is built from `siteId` rather than from the name and
 * subdomain the document already knows: `OgImageRequest` in
 * `packages/domain/src/og-image/schema.ts` rejects anything else, and a name
 * the client supplied would go stale the moment the board is renamed.
 *
 * Kept free of imports so the URL shape is unit-testable without the server
 * runtime `public-board-data` pulls in.
 */

/**
 * The image kinds the renderer accepts. Mirrors the `type` literals in
 * `OgImageRequest`; there is no changelog-detail image, so a changelog entry
 * advertises the changelog's main image.
 */
type OgImagePageType =
  | "changelog-main"
  | "feedback-main"
  | "post-detail"
  | "roadmap-main";

/** The page kind for a public path, ignoring post detail (which needs a slug). */
function pageTypeForPath(pathname: string): OgImagePageType {
  if (pathname.startsWith("/roadmap")) {
    return "roadmap-main";
  }
  if (pathname.startsWith("/changelog")) {
    return "changelog-main";
  }
  return "feedback-main";
}

/**
 * Builds the absolute `/og-image` URL for a board page.
 *
 * `pathname` is the path the visitor asked for (not the internal `/s` route),
 * and `postSlug` is set only when a post detail resolved, because that image
 * embeds the post's live title and upvote count and the renderer needs the
 * slug to find it.
 */
export function buildOgImageUrl({
  apiUrl,
  pathname,
  postSlug,
  siteId,
}: {
  readonly apiUrl: string;
  readonly pathname: string;
  readonly postSlug: string | null;
  readonly siteId: string;
}): string {
  const url = new URL("/og-image", apiUrl);
  url.searchParams.set("siteId", siteId);

  if (postSlug !== null) {
    url.searchParams.set("type", "post-detail");
    url.searchParams.set("post", postSlug);
    return url.toString();
  }

  url.searchParams.set("type", pageTypeForPath(pathname));
  return url.toString();
}
