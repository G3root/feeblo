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
import { Spinner } from "@feeblo/ui/spinner";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { minSubdomainLength } from "../../lib/register-draft";
import { useSlugAvailabilityContext } from "../../lib/slug-availability-context";
import { registerFormOpts } from "../../shared-form";

const appRootDomain = getRuntimePublicEnv().appRootDomain;

/**
 * The indicator that sits inside the field.
 *
 * The check takes a request, and a request with no visible state reads as a
 * field that has stopped working: you type, nothing happens, and the button
 * below stays disabled for a reason nobody can see. The spinner is the coss
 * input-group pattern for exactly this, and the two settling icons are the
 * answer drawn where the reader is already looking instead of a line of text
 * they have to find.
 */
function StatusIndicator({
  status,
}: {
  readonly status: "idle" | "checking" | "available" | "taken" | "error";
}) {
  if (status === "checking") {
    return <Spinner className="text-muted-foreground size-4" />;
  }

  if (status === "available") {
    return (
      <HugeiconsIcon
        aria-hidden
        className="size-4 text-emerald-600"
        icon={CheckmarkCircle02Icon}
      />
    );
  }

  if (status === "taken" || status === "error") {
    return (
      <HugeiconsIcon
        aria-hidden
        className="text-destructive size-4"
        icon={AlertCircleIcon}
      />
    );
  }

  return null;
}

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
                  aria-describedby={`${field.name}-status`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const next = event.target.value.trim().toLowerCase();

                    field.handleChange(next);
                    reportSlug(next);
                  }}
                  placeholder="acme-labs"
                  spellCheck={false}
                  value={field.state.value}
                />
                <InputGroupAddon align="inline-end">
                  <StatusIndicator status={status} />
                  {appRootDomain ? (
                    <InputGroupText>.{appRootDomain}</InputGroupText>
                  ) : null}
                </InputGroupAddon>
              </InputGroup>

              {/* The field reports its own state visually; this is the same
                  news for a screen reader, which cannot see a spinner. */}
              <div aria-live="polite">
                {status === "checking" ? (
                  <FieldDescription id={`${field.name}-status`}>
                    Checking whether this address is free…
                  </FieldDescription>
                ) : null}

                {status === "available" ? (
                  <FieldDescription
                    className="text-emerald-600"
                    id={`${field.name}-status`}
                  >
                    This address is free.
                  </FieldDescription>
                ) : null}

                {status === "taken" ? (
                  <div className="flex flex-col gap-2">
                    <FieldError id={`${field.name}-status`}>
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
                  <FieldError id={`${field.name}-status`}>
                    Could not check this address. Keep typing to try again.
                  </FieldError>
                ) : null}

                {status === "idle" ? (
                  <FieldDescription id={`${field.name}-status`}>
                    Lowercase letters, numbers and hyphens, at least{" "}
                    {minSubdomainLength} characters. This is where your public
                    board lives.
                  </FieldDescription>
                ) : null}
              </div>
            </Field>
          );
        }}
      </form.AppField>
    );
  },
});
