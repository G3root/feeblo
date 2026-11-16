interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  /** Defaults to the visitor's locale, which is what the browser already knows. */
  locale?: string;
}

/** Formats a date for display inside the table's filters and chips. */
export function formatDate(
  date: Date | string | number | undefined,
  { locale, ...options }: FormatDateOptions = {}
): string {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat(locale, {
      month: options.month ?? "long",
      day: options.day ?? "numeric",
      year: options.year ?? "numeric",
      ...options,
    }).format(new Date(date));
  } catch {
    return "";
  }
}
