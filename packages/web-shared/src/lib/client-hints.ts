import { getHintUtils } from "@epic-web/client-hints";
import { clientHint as timeZoneHint } from "@epic-web/client-hints/time-zone";

export const defaultTimeZone = "America/New_York";
export const timeZoneHintCookieName = timeZoneHint.cookieName;

const isValidTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value === "UTC" || value.includes("/");
  } catch {
    return false;
  }
};

const hintUtils = getHintUtils({
  timeZone: {
    ...timeZoneHint,
    fallback: defaultTimeZone,
    transform: (value: string) =>
      isValidTimeZone(value) ? value : defaultTimeZone,
  },
});

export const { getClientHintCheckScript, getHints } = hintUtils;

//TODO use a cookie parser
export const getClientTimeZone = (): string | undefined => {
  if (
    typeof document === "undefined" ||
    !document.cookie
      .split(";")
      .some((cookie) => cookie.trim().startsWith(`${timeZoneHintCookieName}=`))
  ) {
    return undefined;
  }
  return getHints().timeZone;
};
