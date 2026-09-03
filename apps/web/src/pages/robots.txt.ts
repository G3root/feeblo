import type { APIRoute } from "astro";

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
      // and the dashboard host serve different bodies from different routes.
      Vary: "Host",
    },
  });

/**
 * robots.txt for the dashboard host (`app.<root-domain>` and the apex
 * domain), where every page sits behind authentication or is a client-side
 * app shell with no indexable content. Public board hosts serve their own
 * robots.txt from `pages/s/[...subDomain]/robots.txt.ts`.
 */
export const GET: APIRoute = async () =>
  robotsResponse(["User-agent: *", "Disallow: /"]);
