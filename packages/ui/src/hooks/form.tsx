import { createFormHook } from "@tanstack/react-form";
import { Button } from "../button";
import { fieldContext, formContext, useFormContext } from "../form-context";
import { TextField } from "../text-field";
import { TextareaField } from "../textarea-field";

interface SubscribeButtonProps extends React.ComponentProps<typeof Button> {
  label?: string;
}

function SubscribeButton({
  label,
  type = "submit",
  children,
  ...props
}: SubscribeButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} disabled={isSubmitting} type={type}>
          {children ?? label}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    TextareaField,
  },
  formComponents: {
    SubscribeButton,
  },
  fieldContext,
  formContext,
});
