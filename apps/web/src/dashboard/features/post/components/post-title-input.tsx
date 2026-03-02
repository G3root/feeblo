import { useId } from "react";
import { cn } from "~/lib/utils";

interface PostTitleInputProps
  extends Omit<React.ComponentProps<"input">, "size"> {
  size?: "default" | "sm";
}

export function PostTitleInput({
  className,
  size = "default",
  ...props
}: PostTitleInputProps) {
  const generateId = useId();
  const id = props.id ?? generateId;
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Post Title
      </label>
      <input
        className={cn(
          "w-full border-0 bg-transparent p-0 font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70",
          size === "sm" && "text-base md:text-lg",
          size === "default" && "text-3xl md:text-4xl",
          className
        )}
        {...props}
        id={id}
        type="text"
      />
    </>
  );
}
