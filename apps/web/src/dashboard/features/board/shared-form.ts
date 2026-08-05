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
    visibility: "PUBLIC" as "PUBLIC" | "PRIVATE",
  },
  validators: {
    onSubmit: boardFormSchema,
  },
});
