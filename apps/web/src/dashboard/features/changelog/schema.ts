import { z } from "zod";

import { CHANGELOG_STATUSES } from "./constants";

export const changelogStatusSchema = z.enum(CHANGELOG_STATUSES);

// Mirrors the backend Changelog.coverImage contract (COVER_IMAGE_URL_PATTERN):
// an http(s) URL. The previous z.httpUrl() rejected IP-address hosts (e.g.
// MinIO/R2 dev storage at http://127.0.0.1:9002/...), which made saving a
// changelog with a cover image fail client-side. Keep the regex in sync with
// packages/domain/src/changelog/schema.ts.
const coverImage = z
  .string()
  .max(2048)
  .regex(/^https?:\/\/[^\s]+$/i, "Invalid cover image URL");

export const updatedChangelogSchema = z.object({
  assetIds: z.array(z.string()),
  coverImage: coverImage.nullable(),
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  content: z.string(),
  status: changelogStatusSchema,
  scheduledAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  organizationId: z.string(),
});

export const publishChangelogSchema = z.object({
  slug: z.string().trim().min(1, "A slug is required"),
  publishedAt: z
    .string()
    .trim()
    .min(1, "A published date is required")
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Enter a valid published date"
    ),
});
