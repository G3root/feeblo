import { createFormHook } from "@tanstack/react-form";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/text-field.tsx";
import { TextareaField } from "~/components/ui/textarea-field.tsx";
import { fieldContext, formContext, useFormContext } from "./form-context";

interface SubscribeButtonProps extends React.ComponentProps<typeof Button> {
  label: string;
}

function SubscribeButton({ label, ...props }: SubscribeButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} disabled={isSubmitting}>
          {label}
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
