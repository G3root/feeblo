import type { APIRoute } from "astro";
import { cookieName, locales } from "@/paraglide/runtime";

/**
 * Sets the Paraglide locale cookie and redirects back.
 * Used by language switchers: POST /api/locale?locale=de&redirectTo=/sign-in
 */
export const POST: APIRoute = ({ cookies, request, redirect }) => {
  const params = new URL(request.url).searchParams;
  const redirectTo = params.get("redirectTo") ?? "/";
  // find() doubles as the locale validation and avoids a type assertion.
  const knownLocale = locales.find((candidate) => candidate === params.get("locale"));

  if (knownLocale) {
    cookies.set(cookieName, knownLocale, {
      path: "/",
      sameSite: "lax",
      secure: import.meta.env.PROD,
    });
  }

  return redirect(redirectTo, 303);
};
