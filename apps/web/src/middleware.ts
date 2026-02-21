import type { APIContext, MiddlewareNext } from "astro";

export function onRequest(context: APIContext, next: MiddlewareNext) {
  const { url, request } = context;
  const _host = request.headers.get("host") || "";

  const subdomain = "app";

  if (subdomain) {
    const currentPathname = url.pathname;
    let targetPathPrefix: string;

    if (subdomain === "app") {
      targetPathPrefix = "/dashboard";
    } else {
      // For any other subdomain, map to '/s'
      // Add more specific checks here if you have other subdomains with different mappings
      targetPathPrefix = "/s";
    }

    // Check if the current path already starts with the target prefix
    if (!currentPathname.startsWith(targetPathPrefix)) {
      // If currentPathname is '/', rewrite to targetPathPrefix (e.g., '/dashboard')
      // Otherwise, prepend targetPathPrefix to currentPathname (e.g., '/dashboard/settings')
      const newPath =
        currentPathname === "/"
          ? targetPathPrefix
          : `${targetPathPrefix}${currentPathname}`;
      return context.rewrite(newPath);
    }
  }

  return next();
}
