export const clientTimeZoneHeader = "x-feeblo-time-zone";

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone === "UTC" || timeZone.includes("/");
  } catch {
    return false;
  }
};
