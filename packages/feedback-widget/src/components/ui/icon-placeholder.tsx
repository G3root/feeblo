import { splitProps, type JSX } from "solid-js";
import { cn } from "../../lib/utils";

export function IconPlaceholder(props: { class?: string }): JSX.Element {
  const [local] = splitProps(props, ["class"]);
  return (
    <span
      aria-hidden="true"
      class={cn(
        "inline-block shrink-0 rounded-[3px] bg-current opacity-25",
        local.class
      )}
    />
  );
}
