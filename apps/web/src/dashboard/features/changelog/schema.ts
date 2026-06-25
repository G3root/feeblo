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

export const publishChangelogSchema = z
  .object({
    mode: z.enum(["publish-now", "schedule-later"]),
    scheduledAt: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "schedule-later") {
      return;
    }

    if (!value.scheduledAt) {
      ctx.addIssue({
        code: "custom",
        message: "A publish date is required",
        path: ["scheduledAt"],
      });
      return;
    }

    const parsed = new Date(value.scheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid publish date",
        path: ["scheduledAt"],
      });
      return;
    }

    if (parsed.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a future date and time",
        path: ["scheduledAt"],
      });
    }
  });

export type TPublishChangelogValues = z.infer<typeof publishChangelogSchema>;
