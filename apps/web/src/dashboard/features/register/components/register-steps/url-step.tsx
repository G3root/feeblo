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

import { minSubdomainLength } from "../../lib/register-draft";
import { useSlugAvailabilityContext } from "../../lib/slug-availability-context";
import { registerFormOpts } from "../../shared-form";

const appRootDomain = getRuntimePublicEnv().appRootDomain;

/**
 * Step two: the address.
 *
 * The reader types it. Two workspaces can want the same name and only one can
 * have the address, so deriving it from the name would hand the second person a
 * URL they did not choose and cannot fix without renaming the workspace.
 *
 * The check runs while they type (the machine is debounced), and Continue stays
 * disabled until it says the address is free. The server checks again; this is
 * about not letting someone fill in three more steps before finding out.
 */
export const UrlStep = withForm({
  ...registerFormOpts,
  render: function UrlStepRender({ form }) {
    const { availability, reportSlug } = useSlugAvailabilityContext();
    const { reason, status, suggestion } = availability;

    return (
      <form.AppField name="subdomain">
        {(field) => {
          const isInvalid = status === "taken" || status === "error";

          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Board address</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  autoCapitalize="none"
                  autoCorrect="off"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const next = event.target.value.toLowerCase();

                    field.handleChange(next);
                    reportSlug(next);
                  }}
                  placeholder="acme-labs"
                  spellCheck={false}
                  value={field.state.value}
                />
                {appRootDomain ? (
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>.{appRootDomain}</InputGroupText>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>

              {status === "checking" ? (
                <FieldDescription>Checking availability…</FieldDescription>
              ) : null}

              {status === "available" ? (
                <FieldDescription className="text-emerald-600">
                  This address is free.
                </FieldDescription>
              ) : null}

              {status === "taken" ? (
                <div className="flex flex-col gap-2">
                  <FieldError>
                    {reason ?? "Someone already has this address."}
                  </FieldError>
                  {suggestion === null ? null : (
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          field.handleChange(suggestion);
                          reportSlug(suggestion);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Use {suggestion}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              {status === "error" ? (
                <FieldError>
                  Could not check this address. Keep typing to try again.
                </FieldError>
              ) : null}

              {status === "idle" || status === "available" ? (
                <FieldDescription>
                  Lowercase letters, numbers and hyphens, at least{" "}
                  {minSubdomainLength} characters. This is where your public
                  board lives.
                </FieldDescription>
              ) : null}
            </Field>
          );
        }}
      </form.AppField>
    );
  },
});
