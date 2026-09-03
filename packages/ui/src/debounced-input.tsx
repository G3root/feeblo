import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useEffect, useRef, useState } from "react";

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
  const [prevValue, setPrevValue] = useState(value);

  // Sync external value changes during render, not in an effect: avoids an
  // extra commit per parent update and never clobbers in-flight typing with
  // a stale parent value arriving mid-debounce.
  if (prevValue !== value) {
    setPrevValue(value);
    setLocalValue(value ?? "");
  }

  // Ref seam: the debounced fn outlives the render that created it, so it
  // must invoke the latest `onChange` without resubscribing every render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const emitDebounced = useDebouncedCallback(
    (next: string) => onChangeRef.current(next),
    { wait }
  );

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
