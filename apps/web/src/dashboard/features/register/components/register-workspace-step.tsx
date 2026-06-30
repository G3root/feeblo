import { Button } from "@feeblo/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@feeblo/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { useStore } from "@tanstack/react-store";
import { withForm } from "@feeblo/ui/hooks/form";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useWorkspaceSlugAvailability } from "../hooks/use-workspace-slug-availability";
import { registerFormOpts } from "../shared-form";
import { toWorkspaceSlug } from "../utils";

const appRootDomain = getRuntimePublicEnv().appRootDomain;

interface SlugCheckForm {
  setFieldValue: (name: "workspaceName", value: string) => void;
}

function renderSlugFooter(
  slug: string,
  slugStatus: "idle" | "checking" | "available" | "taken" | "error",
  suggestion: string | null,
  form: SlugCheckForm
) {
  if (slug.length < 4) {
    return (
      <FieldDescription>
        Workspace name must produce a slug of at least 4 characters.
      </FieldDescription>
    );
  }
  if (slugStatus === "checking") {
    return <FieldDescription>Checking availability…</FieldDescription>;
  }
  if (slugStatus === "available") {
    return (
      <FieldDescription className="text-emerald-600">
        Name is available.
      </FieldDescription>
    );
  }
  if (slugStatus === "taken") {
    return (
      <div className="flex flex-col gap-2">
        <FieldError>This name is already taken.</FieldError>
        {suggestion ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() =>
                form.setFieldValue(
                  "workspaceName",
                  suggestion.replace(/-/g, " ")
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Use {suggestion}
            </Button>
            <FieldDescription>{suggestion}</FieldDescription>
          </div>
        ) : null}
      </div>
    );
  }
  if (slugStatus === "error") {
    return <FieldError>Could not check availability. Try again.</FieldError>;
  }
  return null;
}

export const RegisterWorkspaceStep = withForm({
  ...registerFormOpts,
  render: ({ form }) => {
    const workspaceName = useStore(
      form.store,
      (state) => (state.values.workspaceName as string) || ""
    );

    const slug = toWorkspaceSlug(workspaceName);
    const { status: slugStatus, suggestion } = useWorkspaceSlugAvailability(
      slug,
      slug.length >= 4
    );

    return (
      <div className="flex flex-col gap-4">
        <form.AppField name="workspaceName">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Workspace Name</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={field.name}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Acme Labs"
                    value={String(field.state.value ?? "")}
                  />
                </InputGroup>
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.AppField>

        <Field data-invalid={slugStatus === "taken"}>
          <FieldLabel>Subdomain</FieldLabel>
          <InputGroup>
            <InputGroupInput
              disabled
              placeholder="acme-labs"
              readOnly
              tabIndex={-1}
              value={slug}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>.{appRootDomain}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {renderSlugFooter(slug, slugStatus, suggestion, form)}
        </Field>
      </div>
    );
  },
});
