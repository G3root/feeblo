import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

/**
 * Mirrors the server's `ApiKeyCreate` payload: a name between 1 and 32
 * characters. The server keeps the same bound, so this is a courtesy check
 * rather than the enforcement point.
 */
export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the key")
    .max(32, "Use 32 characters or fewer"),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

export const apiKeyFormOpts = formOptions({
  defaultValues: { name: "" },
  validators: {
    onSubmit: apiKeyFormSchema,
  },
});
