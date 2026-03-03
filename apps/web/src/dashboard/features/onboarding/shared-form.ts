import { z } from "zod";

export const onboardingFormSchema = z.object({
  workspaceName: z.string().trim().min(2, "Workspace name is required"),
});

export const onboardingFormOpts = {
  defaultValues: {
    workspaceName: "",
  },
  validators: {
    onChange: onboardingFormSchema,
  },
};
