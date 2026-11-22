import { useSelector } from "@tanstack/react-store";
import { useId } from "react";

import { Field, FieldDescription, FieldError } from "./field";
import { useFieldContext } from "./form-context";
import { Input } from "./input";
import { Label } from "./label";
import { cn } from "./utils";

interface TextFieldProps extends React.ComponentProps<typeof Input> {
  /**
   * Rendered inside this field's `Field.Root`, so it stays associated with the
   * input. A description placed beside `<TextField>` instead sits outside that
   * root, where Base UI throws `FieldRootContext is missing`.
   */
  description?: React.ReactNode;
  hideLabel?: boolean;
  label: string;
}

export function TextField({
  label,
  description,
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
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={errors} match={!isValid} />
    </Field>
  );
}
