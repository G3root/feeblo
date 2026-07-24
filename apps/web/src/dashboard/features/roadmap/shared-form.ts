import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const roadmapColumnFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Name is required").max(120),
  statusId: z.string().min(1, "Status is required"),
});

export type RoadmapColumnFormValues = z.infer<typeof roadmapColumnFormSchema>;

export const roadmapFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).nullable(),
  visibility: z.enum(["public", "private"]),
  columns: z.array(roadmapColumnFormSchema).max(50),
});

export type RoadmapFormValues = z.infer<typeof roadmapFormSchema>;

export const roadmapFormOpts = formOptions({
  defaultValues: {
    name: "",
    description: null as string | null,
    visibility: "public" as "public" | "private",
    columns: [] as RoadmapColumnFormValues[],
  },
  validators: {
    onSubmit: roadmapFormSchema,
  },
});
