import { Field, FieldError, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";

import type { GitHubConnection, GitHubRepository } from "../atoms";
import { githubPostIssueFormOpts } from "../shared-form";

type GitHubConnectionFieldProps = {
  readonly connections: readonly GitHubConnection[];
};

type GitHubRepositoryFieldProps = {
  readonly disabled: boolean;
  readonly repositories: readonly GitHubRepository[];
};

export const GitHubConnectionField = withForm({
  ...githubPostIssueFormOpts,
  props: { connections: [] } as GitHubConnectionFieldProps,
  render: ({ form, connections }) => (
    <form.AppField
      children={(field) => (
        <Field
          dirty={field.state.meta.isDirty}
          invalid={!field.state.meta.isValid}
          name={field.name}
          touched={field.state.meta.isTouched}
        >
          <FieldLabel>GitHub App installation</FieldLabel>
          <Select
            onValueChange={(value) => {
              field.handleChange(String(value ?? ""));
              // Repositories are scoped to the installation, so clear the
              // previous selection when the installation changes.
              form.setFieldValue("repositoryFullName", "");
            }}
            value={field.state.value}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a GitHub App installation">
                {(value: string) =>
                  connections.find((connection) => connection.id === value)
                    ?.login ?? "GitHub installation"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.login ?? "GitHub installation"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldError
            errors={field.state.meta.errors}
            match={!field.state.meta.isValid}
          />
        </Field>
      )}
      name="connectionId"
    />
  ),
});

export const GitHubRepositoryField = withForm({
  ...githubPostIssueFormOpts,
  props: {
    disabled: false,
    repositories: [],
  } as GitHubRepositoryFieldProps,
  render: ({ form, disabled, repositories }) => (
    <form.AppField
      children={(field) => (
        <Field
          dirty={field.state.meta.isDirty}
          invalid={!field.state.meta.isValid}
          name={field.name}
          touched={field.state.meta.isTouched}
        >
          <FieldLabel>Repository</FieldLabel>
          <Select
            disabled={disabled}
            onValueChange={(value) => field.handleChange(String(value ?? ""))}
            value={field.state.value}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a repository">
                {(value: string) =>
                  repositories.find(
                    (repository) => repository.fullName === value
                  )?.fullName ?? "Select a repository"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {repositories.map((repository) => (
                <SelectItem
                  key={repository.fullName}
                  value={repository.fullName}
                >
                  {repository.fullName}
                  {repository.private ? " (private)" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldError
            errors={field.state.meta.errors}
            match={!field.state.meta.isValid}
          />
        </Field>
      )}
      name="repositoryFullName"
    />
  ),
});
