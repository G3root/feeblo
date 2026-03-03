import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { Input } from "./input";

interface DebouncedInputProps
  extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  onChange: (value: string) => void;
  value?: string;
  wait?: number;
}

function DebouncedInput({
  value,
  onChange,
  wait = 300,
  ...props
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value ?? "");

  useEffect(() => {
    setLocalValue(value ?? "");
  }, [value]);

  const emitDebounced = useDebouncedCallback(onChange, { wait });

  return (
    <Input
      {...props}
      onChange={(e) => {
        setLocalValue(e.target.value);
        emitDebounced(e.target.value);
      }}
      value={localValue}
    />
  );
}

export { DebouncedInput };
export type { DebouncedInputProps };
