import { useSelector } from "@tanstack/react-store";
import { useId } from "react";
import { Field, FieldError } from "./field";
import { useFieldContext } from "./form-context";
import { Input } from "./input";
import { Label } from "./label";
import { cn } from "./utils";

interface TextFieldProps extends React.ComponentProps<typeof Input> {
  hideLabel?: boolean;
  label: string;
}

export function TextField({
  label,
  hideLabel,
  id: idProp,
  onChange,
  ...props
}: TextFieldProps) {
  const generateId = useId();
  const id = idProp ?? generateId;
  const field = useFieldContext<string>();

  const errors = useSelector(field.store, (state) => state.meta.errors);
  const isTouched = useSelector(field.store, (state) => state.meta.isTouched);
  const isDirty = useSelector(field.store, (state) => state.meta.isDirty);
  const isValid = useSelector(field.store, (state) => state.meta.isValid);

  return (
    <Field
      dirty={isDirty}
      invalid={!isValid}
      name={field.name}
      touched={isTouched}
    >
      <Label className={hideLabel ? "sr-only" : ""} htmlFor={id}>
        {label}
      </Label>
      <Input
        {...props}
        className={cn(props.className)}
        id={id}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
          onChange?.(event);
        }}
        value={field.state.value}
      />
      <FieldError errors={errors} match={!isValid} />
    </Field>
  );
}
