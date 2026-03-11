import { VITE_APP_URL } from "astro:env/client";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name: string | null | undefined) {
  const normalized = name?.trim();

  if (!normalized) {
    return "??";
  }

  const segments = normalized.split(/\s+/).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}

export function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatPostStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(value: string, maxLength = 180) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

export function hasRichTextContent(value: string) {
  return /<[a-z][\s\S]*>/i.test(value);
}

export function getDashboardSignInUrl() {
  return new URL("/sign-in", VITE_APP_URL).toString();
}

export function toSortedByCreatedAt<T extends { createdAt: Date | string }>(
  items: readonly T[]
) {
  return [...items].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}
