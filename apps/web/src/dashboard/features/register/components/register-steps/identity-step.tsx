import { Button } from "@feeblo/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { Input } from "@feeblo/ui/input";
import { getInitials } from "@feeblo/ui/user-avatar";
import { useStore } from "@tanstack/react-store";
import { useId, useRef } from "react";

import { useObjectUrl } from "../../hooks/use-object-url";
import { registerFormOpts } from "../../shared-form";

/**
 * Step one: the name and the logo.
 *
 * One step because they answer the same question. The name is what the sidebar
 * and the board header say; the logo is what sits in front of it. Asking for
 * one and then the other would be two screens for a single decision.
 */
export const IdentityStep = withForm({
  ...registerFormOpts,
  render: function IdentityStepRender({ form }) {
    const logo = useStore(form.store, (state) => state.values.logo);

    const workspaceName = useStore(
      form.store,
      (state) => state.values.workspaceName
    );

    const logoUrl = useObjectUrl(logo);
    const fileInputId = useId();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const initials = getInitials(workspaceName);

    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border text-lg font-semibold">
            {logoUrl === null ? (
              <span aria-hidden>{initials}</span>
            ) : (
              <img
                alt="Workspace logo"
                className="size-full object-cover"
                src={logoUrl}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-medium">Workspace logo</p>
            <p className="text-muted-foreground text-xs">
              Square images look best. You can change it later in settings.
            </p>

            <div className="flex items-center gap-2">
              <input
                accept="image/*"
                className="sr-only"
                id={fileInputId}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  form.setFieldValue("logo", file);
                }}
                ref={fileInputRef}
                type="file"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {logo === null ? "Add a logo" : "Change logo"}
              </Button>

              {logo === null ? null : (
                <Button
                  onClick={() => {
                    form.setFieldValue("logo", null);

                    // The same file cannot be picked twice unless the input is
                    // cleared, which also keeps the change event firing.
                    if (fileInputRef.current !== null) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        <form.AppField name="workspaceName">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;

            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Workspace name</FieldLabel>
                <Input
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Acme Labs"
                  value={field.state.value}
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : (
                  <FieldDescription>
                    Shown in the sidebar, on your board and in emails.
                  </FieldDescription>
                )}
              </Field>
            );
          }}
        </form.AppField>
      </div>
    );
  },
});
