import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";

export const prerender = false;

const robotsResponse = (lines: ReadonlyArray<string>) =>
  new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      //TODO: Re-evaluate caching (same constraint as rss.xml.ts: no
      // mutation-triggered cache purge yet, so noIndex changes must surface
      // within the cache lifetime).
      "Cache-Control": "public, max-age=300, s-maxage=300",
      // robots.txt is per-host content on a shared path; public board hosts
      // and the dashboard host serve different bodies from the same route.
      Vary: "Host",
    },
  });

/**
 * robots.txt for public board hosts, served at
 * `https://<subdomain>.<root-domain>/robots.txt`.
 *
 * The middleware resolves `locals.site` from the request host. Sites flagged
 * `noIndex` (or a deployment with the `NO_INDEX` env secret) get a
 * blanket `Disallow` with no sitemap link: neither crawlable nor advertised.
 *
 * For indexable sites the disallowed paths are the ones that exist on public
 * board hosts but carry no indexable content: the dashboard auth pages (the
 * middleware keeps serving them from the dashboard app on any host), the
 * feedback widget document, and the internal `/s/...` rewrite prefix whose
 * pages duplicate the canonical public URLs.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const site = locals.site;
  const origin = url.origin;

  if (site === null || site.noIndex || Boolean(getSecret("NO_INDEX"))) {
    return robotsResponse(["User-agent: *", "Disallow: /"]);
  }

  return robotsResponse([
    "User-agent: *",
    "Allow: /",
    "Disallow: /s/",
    "Disallow: /feedback-widget",
    "Disallow: /sign-in",
    "Disallow: /sign-up",
    "Disallow: /email-verify",
    "Disallow: /forgot-password",
    "Disallow: /reset-password",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ]);
};
