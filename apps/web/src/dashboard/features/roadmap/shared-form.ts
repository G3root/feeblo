import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const roadmapFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).nullable(),
  visibility: z.enum(["public", "private"]),
});

export type RoadmapFormValues = z.infer<typeof roadmapFormSchema>;

export const roadmapFormOpts = formOptions({
  defaultValues: {
    name: "",
    description: null as string | null,
    visibility: "public" as "public" | "private",
  },
  validators: {
    onSubmit: roadmapFormSchema,
  },
});
