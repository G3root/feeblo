import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export type GitHubPostIssueAction = "create" | "link";

/** Safe, non-secret values collected by the GitHub issue create/link dialog. */
export const githubPostIssueFormSchema = z
  .object({
    action: z.enum(["create", "link"]),
    connectionId: z.string().min(1, "Select a GitHub App installation"),
    repositoryFullName: z
      .string()
      .min(1, "Select a repository")
      .refine((value) => value.includes("/"), "Select a repository"),
    issueNumber: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.action !== "link") {
      return;
    }
    const trimmed = value.issueNumber.trim();
    if (trimmed === "") {
      ctx.addIssue({
        code: "custom",
        message: "Enter an issue number",
        path: ["issueNumber"],
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid issue number",
        path: ["issueNumber"],
      });
    }
  });

export type GitHubPostIssueFormValues = z.infer<
  typeof githubPostIssueFormSchema
>;

export const githubPostIssueFormOpts = formOptions({
  defaultValues: {
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    action: "create" as GitHubPostIssueAction,
    connectionId: "",
    repositoryFullName: "",
    issueNumber: "",
  },
  validators: {
    onSubmit: githubPostIssueFormSchema,
  },
});
