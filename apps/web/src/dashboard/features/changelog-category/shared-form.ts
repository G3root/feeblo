import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const CHANGELOG_CATEGORY_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#a855f7",
] as const;

type TColor = (typeof CHANGELOG_CATEGORY_COLORS)[number];

export const changelogCategoryFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required"),
  color: z.enum(CHANGELOG_CATEGORY_COLORS),
});

export type ChangelogCategoryFormValues = z.infer<
  typeof changelogCategoryFormSchema
>;

export const changelogCategoryFormOpts = formOptions({
  defaultValues: {
    name: "",
    color: CHANGELOG_CATEGORY_COLORS[0] as TColor,
  },
  validators: {
    onSubmit: changelogCategoryFormSchema,
  },
});
