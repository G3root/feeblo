import { Button } from "@feeblo/ui/button";
import {
  fieldContext,
  formContext,
  useFormContext,
} from "@feeblo/ui/form-context";
import { TextField } from "@feeblo/ui/text-field";
import { TextareaField } from "@feeblo/ui/textarea-field";
import { createFormHook } from "@tanstack/react-form";

interface SubscribeButtonProps extends React.ComponentProps<typeof Button> {
  label: string;
}

function SubscribeButton({
  label,
  type = "submit",
  ...props
}: SubscribeButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} disabled={isSubmitting} type={type}>
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
