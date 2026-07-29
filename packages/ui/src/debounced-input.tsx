import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { Input, type InputProps } from "./input";
import { InputGroupInput } from "./input-group";

interface DebouncedInputProps extends Omit<InputProps, "onChange" | "value"> {
  onChange: (value: string) => void;
  value?: string;
  wait?: number;
}

const useDebounce = ({
  onChange,
  value,
  wait = 300,
}: {
  onChange: DebouncedInputProps["onChange"];
  value: string;
  wait: number;
}) => {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value ?? "");
  }, [value]);

  const emitDebounced = useDebouncedCallback(onChange, { wait });

  return { emitDebounced, setLocalValue, localValue };
};

function DebouncedInput({
  value,
  onChange,
  wait = 300,
  ...props
}: DebouncedInputProps) {
  const { emitDebounced, localValue, setLocalValue } = useDebounce({
    value: value ?? "",
    onChange,
    wait,
  });

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

function DebouncedInputGroupInput({
  value,
  onChange,
  wait = 300,
  ...props
}: DebouncedInputProps) {
  const { emitDebounced, localValue, setLocalValue } = useDebounce({
    value: value ?? "",
    onChange,
    wait,
  });
  return (
    <InputGroupInput
      {...props}
      onChange={(e) => {
        setLocalValue(e.target.value);
        emitDebounced(e.target.value);
      }}
      value={localValue}
    />
  );
}

export { DebouncedInput, DebouncedInputGroupInput };
export type { DebouncedInputProps };
