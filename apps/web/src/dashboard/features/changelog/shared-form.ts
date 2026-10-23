import { formOptions } from "@tanstack/react-form";

import { publishChangelogSchema } from "./schema";

export const publishChangelogFormOpts = formOptions({
  defaultValues: {
    slug: "",
    publishedAt: "",
  },
  validators: {
    onSubmit: publishChangelogSchema,
  },
});
