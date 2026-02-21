import { useStore } from "@tanstack/react-store";
import { useId } from "react";
import { useFieldContext } from "~/hooks/form-context";
import { cn } from "~/lib/utils";
import { Input } from "./input";
import { Label } from "./label";

interface TextFieldProps extends React.ComponentProps<"input"> {
  hideLabel?: boolean;
  label: string;
}

export function TextField({
  label,
  hideLabel,
  id: idProp,
  ...props
}: TextFieldProps) {
  const id = idProp ?? useId();
  const field = useFieldContext<string>();

  const errors = useStore(field.store, (state) => state.meta.errors);
  const isTouched = useStore(field.store, (state) => state.meta.isTouched);

  return (
    <div className="flex flex-col gap-2">
      <Label className={hideLabel ? "sr-only" : ""} htmlFor={id}>
        {label}
      </Label>
      <Input
        {...props}
        className={cn(props.className)}
        id={id}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        value={field.state.value}
      />

      {isTouched && errors.length > 0 ? (
        <div className="flex flex-col gap-1">
          {errors.map((error: { message: string }) => (
            <p className="text-destructive text-sm" key={error.message}>
              {error.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
