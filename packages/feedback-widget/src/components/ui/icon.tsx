import { type ComponentProps, type JSX, splitProps } from "solid-js";
import type { IconName } from "../../icons/types";
import { cn } from "../../lib/utils";

export function Icon(
  props: ComponentProps<"svg"> & { name: IconName }
): JSX.Element {
  const [local, others] = splitProps(props, ["name", "class"]);
  return (
    <svg
      aria-hidden="true"
      class={cn("inline-block shrink-0", local.class)}
      {...others}
    >
      <use href={`#${local.name}`} />
    </svg>
  );
}
