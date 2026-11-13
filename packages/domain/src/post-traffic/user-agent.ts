/**
 * The client dimensions stored on a page view.
 *
 * The values are closed sets rather than whatever the user agent said. A
 * breakdown with a thousand spellings of "Chrome" is a breakdown nobody can
 * read, and a closed vocabulary is what keeps the dashboard's grouping honest.
 */
import type { TPostViewDeviceHint } from "./schema";

export type TPostViewClient = {
  readonly browser: string;
  readonly device: string;
  readonly os: string;
};

const OTHER: TPostViewClient = {
  browser: "Other",
  device: "unknown",
  os: "Other",
};

const WINDOWS_OS = /Windows/i;
const IOS = /iPhone|iPad|iPod/i;
const ANDROID = /Android/i;
const MACOS = /Macintosh|Mac OS X/i;
const CHROME_OS = /CrOS/i;
const LINUX = /Linux/i;

const EDGE = /Edg(?:e|A|iOS)?\//i;
const OPERA = /OPR\/|Opera|OPiOS/i;
const CHROME = /Chrome\/|CriOS\//i;
const FIREFOX = /Firefox\/|FxiOS/i;
const SAFARI = /Safari\//i;
const SAFARI_VERSION = /Version\//i;

const TABLET = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i;
const MOBILE = /Mobi|iPhone|iPod|Windows Phone|IEMobile|Android.*Mobile/i;

const osOf = (userAgent: string): string => {
  // iOS before macOS: an iPad's agent contains "Mac OS X" on some versions.
  if (IOS.test(userAgent)) return "iOS";
  if (ANDROID.test(userAgent)) return "Android";
  if (CHROME_OS.test(userAgent)) return "ChromeOS";
  if (WINDOWS_OS.test(userAgent)) return "Windows";
  if (MACOS.test(userAgent)) return "macOS";
  if (LINUX.test(userAgent)) return "Linux";
  return "Other";
};

const browserOf = (userAgent: string): string => {
  // Edge and Opera both claim Chrome, so they are checked first. Safari is
  // checked last: Chrome's agent carries "Safari/" too, but not "Version/".
  if (EDGE.test(userAgent)) return "Edge";
  if (OPERA.test(userAgent)) return "Opera";
  if (CHROME.test(userAgent)) return "Chrome";
  if (FIREFOX.test(userAgent)) return "Firefox";
  if (SAFARI.test(userAgent) && SAFARI_VERSION.test(userAgent)) return "Safari";
  return "Other";
};

const deviceOf = (
  userAgent: string,
  hint: TPostViewDeviceHint | undefined
): string => {
  if (hint !== undefined) {
    return hint;
  }
  if (TABLET.test(userAgent)) return "tablet";
  if (MOBILE.test(userAgent)) return "mobile";
  // iPadOS 13+ reports a Macintosh agent. Without the browser's own hint a
  // Macintosh agent is a Mac or an iPad, so claiming desktop would overstate
  // what the agent proves.
  if (MACOS.test(userAgent)) return "unknown";
  return "desktop";
};

/**
 * Parse a user agent into the three coarse dimensions the dashboard groups by.
 *
 * Deliberately a small, total function over a closed vocabulary: it is not a
 * device database, and every branch returns a value. The caller discards the
 * user agent itself, so nothing richer than this ever reaches storage.
 */
export const parseUserAgent = (
  userAgent: string,
  deviceHint?: TPostViewDeviceHint
): TPostViewClient => {
  if (userAgent.trim() === "") {
    return OTHER;
  }

  return {
    browser: browserOf(userAgent),
    device: deviceOf(userAgent, deviceHint),
    os: osOf(userAgent),
  };
};
