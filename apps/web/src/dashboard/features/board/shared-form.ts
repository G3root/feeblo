import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const boardFormSchema = z.object({
  name: z.string().trim().min(1, "Board name is required"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
});

export type BoardFormValues = z.infer<typeof boardFormSchema>;

export const boardFormOpts = formOptions({
  defaultValues: {
    name: "",
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    visibility: "PUBLIC" as "PUBLIC" | "PRIVATE",
  },
  validators: {
    onSubmit: boardFormSchema,
  },
});
