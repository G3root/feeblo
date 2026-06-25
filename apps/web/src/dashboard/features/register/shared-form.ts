import { z } from "zod";

export const registerFormSchema = z.object({
  workspaceName: z.string().trim().min(2, "Workspace name is required"),
});

export const registerFormOpts = {
  defaultValues: {
    workspaceName: "",
  },
  validators: {
    onChange: registerFormSchema,
  },
};
