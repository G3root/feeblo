import { m } from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function getRelativeTimeFormatter() {
  const locale = getLocale();
  let formatter = relativeTimeFormatters.get(locale);

  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(locale, formatter);
  }

  return formatter;
}

export function formatRelativeTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return m.mean_house_shrike();
  }

  const rtf = getRelativeTimeFormatter();
  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
}
