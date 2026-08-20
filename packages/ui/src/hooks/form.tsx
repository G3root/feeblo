import { createFormHook } from "@tanstack/react-form";

import { Button } from "../button";
import { fieldContext, formContext, useFormContext } from "../form-context";
import { PasswordField } from "../password-field";
import { TextField } from "../text-field";
import { TextareaField } from "../textarea-field";

interface SubscribeButtonProps extends React.ComponentProps<typeof Button> {
  label?: string;
}

function SubscribeButton({
  label,
  type = "submit",
  children,
  variant = "brand",
  disabled,
  ...props
}: SubscribeButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button
          {...props}
          disabled={disabled || isSubmitting}
          type={type}
          variant={variant}
        >
          {children ?? label}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm, withForm, withFieldGroup, useTypedAppFormContext } =
  createFormHook({
    fieldComponents: {
      PasswordField,
      TextField,
      TextareaField,
    },
    formComponents: {
      SubscribeButton,
    },
    fieldContext,
    formContext,
  });
