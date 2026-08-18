import { EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@tanstack/react-store";
import { useId, useState } from "react";

import { Button } from "./button";
import { Field, FieldError } from "./field";
import { useFieldContext } from "./form-context";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import { Label } from "./label";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";
import { cn } from "./utils";

interface PasswordFieldProps extends React.ComponentProps<
  typeof InputGroupInput
> {
  hideLabel?: boolean;
  label: string;
}

export function PasswordField({
  label,
  hideLabel,
  id: idProp,
  onChange,
  ...props
}: PasswordFieldProps) {
  const generateId = useId();
  const id = idProp ?? generateId;
  const field = useFieldContext<string>();
  const [showPassword, setShowPassword] = useState(false);

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
      <InputGroup>
        <InputGroupInput
          {...props}
          className={cn(props.className)}
          id={id}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={(event) => {
            field.handleChange(event.target.value);
            onChange?.(event);
          }}
          type={showPassword ? "text" : "password"}
          value={field.state.value}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                />
              }
            >
              {showPassword ? (
                <HugeiconsIcon icon={EyeOffIcon} />
              ) : (
                <HugeiconsIcon icon={EyeIcon} />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              {showPassword ? "Hide password" : "Show password"}
            </TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      <FieldError errors={errors} match={!isValid} />
    </Field>
  );
}
