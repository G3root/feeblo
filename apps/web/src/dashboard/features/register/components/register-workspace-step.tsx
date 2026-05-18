import { useStore } from "@tanstack/react-store";
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
import { withForm } from "~/hooks/form";
import { getRuntimePublicEnv } from "~/lib/runtime-public-env";
import { useWorkspaceSlugAvailability } from "../hooks/use-workspace-slug-availability";
import { registerFormOpts } from "../shared-form";
import { toWorkspaceSlug } from "../utils";

const appRootDomain = getRuntimePublicEnv().appRootDomain;

const slugStatusMessages: Partial<
  Record<ReturnType<typeof useWorkspaceSlugAvailability>, React.ReactNode>
> = {
  checking: <FieldDescription>Checking availability…</FieldDescription>,
  available: (
    <FieldDescription className="text-emerald-600">
      Name is available.
    </FieldDescription>
  ),
  taken: <FieldError>This name is already taken.</FieldError>,
  error: <FieldError>Could not check availability. Try again.</FieldError>,
};

export const RegisterWorkspaceStep = withForm({
  ...registerFormOpts,
  render: ({ form }) => {
    const workspaceName = useStore(
      form.store,
      (state) => (state.values.workspaceName as string) || ""
    );

    const slug = toWorkspaceSlug(workspaceName);
    const slugStatus = useWorkspaceSlugAvailability(slug, slug.length >= 2);

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
          {slug.length >= 2 ? slugStatusMessages[slugStatus] : null}
        </Field>
      </div>
    );
  },
});
