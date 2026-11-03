import { Button } from "@feeblo/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useStore } from "@tanstack/react-store";

import { useWorkspaceSlugAvailability } from "../hooks/use-workspace-slug-availability";
import { registerFormOpts } from "../shared-form";
import { MIN_SLUG_LENGTH, toWorkspaceSlug } from "../utils";

const appRootDomain = getRuntimePublicEnv().appRootDomain;

function renderSlugFooter(
  slug: string,
  slugStatus: "idle" | "checking" | "available" | "taken" | "error",
  suggestion: string | null,
  reason: string | null,
  /** Accepts the suggested name; every path that changes the name goes through it. */
  onUseSuggestion: (suggestion: string) => void
) {
  if (slug.length < MIN_SLUG_LENGTH) {
    return (
      <FieldDescription>
        Workspace name must produce a slug of at least {MIN_SLUG_LENGTH}{" "}
        characters.
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
        <FieldError>{reason ?? "This name is already taken."}</FieldError>
        {suggestion ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => onUseSuggestion(suggestion.replace(/-/g, " "))}
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
  render: function RegisterWorkspaceStepRender({ form }) {
    const workspaceName = useStore(
      form.store,
      // SAFETY: The upstream contract guarantees a string here.
      (state) => (state.values.workspaceName as string) || ""
    );

    const slug = toWorkspaceSlug(workspaceName);
    const { availability, reportWorkspaceName } =
      useWorkspaceSlugAvailability(workspaceName);
    const { status: slugStatus, suggestion, reason } = availability;

    /**
     * Every path that changes the name reports it to the machine, so the
     * suggestion button and the input are the same event to the lifecycle.
     */
    const chooseName = (nextWorkspaceName: string) => {
      form.setFieldValue("workspaceName", nextWorkspaceName);
      reportWorkspaceName(nextWorkspaceName);
    };

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
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      reportWorkspaceName(e.target.value);
                    }}
                    placeholder="Acme Labs"
                    value={field.state.value ?? ""}
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
          {renderSlugFooter(slug, slugStatus, suggestion, reason, chooseName)}
        </Field>
      </div>
    );
  },
});
