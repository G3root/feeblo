import { z } from "zod";
import { toWorkspaceSlug } from "./utils";

export const registerFormSchema = z
  .object({
    workspaceName: z.string().trim().min(2, "Workspace name is required"),
  })
  .superRefine((value, ctx) => {
    const slug = toWorkspaceSlug(value.workspaceName);
    if (slug.length < 4) {
      ctx.addIssue({
        code: "custom",
        path: ["workspaceName"],
        message: "Workspace name must produce a slug of at least 4 characters",
      });
    }
  });

export const registerFormOpts = {
  defaultValues: {
    workspaceName: "",
  },
  validators: {
    onChange: registerFormSchema,
  },
};
