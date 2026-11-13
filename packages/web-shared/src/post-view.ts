/**
 * Record one view of a post from the browser.
 *
 * The board renders on the visitor's origin (a subdomain, or a customer's
 * custom domain), so the beacon goes to the page's own `/traffic/view` and the
 * web server forwards it. Posting to the API directly would be a cross-origin
 * write that the API's origin check refuses for a custom domain.
 *
 * Deliberately no identity: no cookie, no fingerprint, no visitor id. One tab
 * session counts one view per post, which is what `sessionStorage` is for here;
 * clearing it counts again, and that is the intended ceiling on precision.
 *
 * The device hint is the one thing the user agent cannot always answer:
 * iPadOS 13+ reports a Macintosh agent. Touch points separate the two without
 * a fingerprint, and omitting the hint tells the server the form factor is
 * genuinely ambiguous.
 */

import { hasWindow } from "@feeblo/utils/runtime-kind";

const RELAY_PATH = "/traffic/view";
const STORAGE_PREFIX = "feeblo:post-view:";

type DeviceHint = "desktop" | "mobile" | "tablet";

// Every target deployment is a secure context, which is what `randomUUID`
// requires; it is also the one id shape the endpoint's schema can rely on.
const newId = (): string => crypto.randomUUID();

const detectDeviceHint = (): DeviceHint | undefined => {
  const userAgent = navigator.userAgent;
  if (/iPad/.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile/.test(userAgent)) return "mobile";
  if (/Android/.test(userAgent)) return "tablet";
  // iPadOS 13+ reports a Macintosh agent. A Mac has no touch points; an iPad
  // has several, and that is enough to tell them apart without a fingerprint.
  if (/Macintosh/.test(userAgent)) {
    return navigator.maxTouchPoints > 1 ? "tablet" : "desktop";
  }
  if (/Windows|Linux|CrOS/.test(userAgent)) return "desktop";
  return undefined;
};

const alreadyCounted = (postId: string): boolean => {
  const key = `${STORAGE_PREFIX}${postId}`;
  try {
    if (sessionStorage.getItem(key) !== null) {
      return true;
    }
    sessionStorage.setItem(key, "1");
    return false;
  } catch {
    // Storage can be disabled in private modes. Counting is better than
    // dropping the view, so a storage failure means "not counted yet".
    return false;
  }
};

/**
 * Track one page view. Safe to call on every mount; the storage guard is what
 * turns that into one view per post per tab session.
 */
export const trackPostView = (postId: string): void => {
  if (!hasWindow()) {
    return;
  }
  // Automated browsers are not readers; this is the same client-side signal the
  // public telemetry uses to skip its own e2e runs.
  if (navigator.webdriver) {
    return;
  }
  if (alreadyCounted(postId)) {
    return;
  }

  // `undefined` is dropped by `JSON.stringify`, so an ambiguous form factor
  // sends no hint rather than a guess.
  const body = JSON.stringify({
    deviceHint: detectDeviceHint(),
    id: newId(),
    postId,
  });
  // A string body with a text/plain type is a CORS-simple request, so the
  // beacon cannot be stopped by a preflight. The relay accepts plain text.
  const sent = navigator.sendBeacon?.(
    RELAY_PATH,
    new Blob([body], { type: "text/plain;charset=UTF-8" })
  );

  if (sent) {
    return;
  }

  void fetch(RELAY_PATH, {
    body,
    headers: { "content-type": "text/plain;charset=UTF-8" },
    keepalive: true,
    method: "POST",
  }).catch(() => {
    // The page has nothing to do about a dropped beacon.
  });
};
