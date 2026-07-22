import { z } from "zod";
import { CHANGELOG_STATUSES } from "./constants";

export const changelogStatusSchema = z.enum(CHANGELOG_STATUSES);

export const updatedChangelogSchema = z.object({
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
