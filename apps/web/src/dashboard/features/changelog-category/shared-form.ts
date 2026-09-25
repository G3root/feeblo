import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const CHANGELOG_CATEGORY_COLORS = [
  "oklch(0.723 0.192 149.579)",
  "oklch(0.623 0.188 259.815)",
  "oklch(0.637 0.208 25.331)",
  "oklch(0.769 0.165 70.08)",
  "oklch(0.627 0.233 303.9)",
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
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    color: CHANGELOG_CATEGORY_COLORS[0] as TColor,
  },
  validators: {
    onSubmit: changelogCategoryFormSchema,
  },
});
