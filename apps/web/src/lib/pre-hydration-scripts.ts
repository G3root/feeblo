import {
  baseLocale,
  cookieName,
  getTextDirection,
  locales,
} from "@/paraglide/runtime.js";

/**
 * The pre-hydration scripts the document shell renders once.
 *
 * These used to be Astro components (`ThemeScript.astro`,
 * `LocaleScript.astro`, `EnvScript.astro`) rendered into every layout. Start
 * renders them through `ScriptOnce`, which executes them during HTML parsing
 * and removes them after hydration — so the same behaviour (theme applied
 * before first paint, locale attributes corrected from the cookie, runtime env
 * available before the client entry) holds without a framework layout.
 */

/** Mirrors `ThemeScript.astro`; keep the two in sync while both exist. */
export const themeScript = `(function () {
  var a;
  try {
    var t = localStorage.getItem("theme") || "auto";
    var v = ["light", "dark", "auto"].includes(t) ? t : "auto";
    if (v === "auto") {
      a = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.classList.add(a, "auto");
    } else {
      document.documentElement.classList.add(v);
    }
  } catch (e) {
    a = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.classList.add(a, "auto");
  }
})();`;

/** Mirrors `LocaleScript.astro`; directions resolve at build time. */
export function localeScript(): string {
  const directions = Object.fromEntries(
    locales.map((locale) => [locale, getTextDirection(locale)])
  );

  return `(function () {
  // Mirror paraglide's \`extractLocaleFromCookie\`: one match, pattern built
  // once. (\`extractLocaleFromCookie\` itself can't be imported here — this
  // script is inline and must run before hydration.)
  var match = document.cookie.match(
    new RegExp("(?:^|;\\\\s*)" + ${JSON.stringify(cookieName)} + "=([^;]*)")
  );
  var value = "";
  if (match) {
    try {
      value = decodeURIComponent(match[1]);
    } catch (error) {
      value = "";
    }
  }
  var locales = ${JSON.stringify(locales)};
  var locale = locales.indexOf(value) === -1 ? ${JSON.stringify(baseLocale)} : value;
  var directions = ${JSON.stringify(directions)};
  document.documentElement.lang = locale;
  document.documentElement.dir = directions[locale] || "ltr";
})();`;
}

/** Mirrors `EnvScript.astro`; the values come from the root route's loader. */
export function envScript(env: Record<string, string | undefined>): string {
  const serialized = JSON.stringify(env).replaceAll("<", "\\u003c");

  return `window.global = window.global || {};
window.global.__ENV = ${serialized};`;
}
