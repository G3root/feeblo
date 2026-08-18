import { formOptions } from "@tanstack/react-form";
import type { z } from "zod";

import { publishChangelogSchema } from "./schema";

export type PublishChangelogFormValues = z.infer<typeof publishChangelogSchema>;

export const publishChangelogFormOpts = formOptions({
  defaultValues: {
    slug: "",
    publishedAt: "",
  },
  validators: {
    onSubmit: publishChangelogSchema,
  },
});
