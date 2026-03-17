import { useId } from "react";
import { Input } from "~/components/ui/input";
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
      <Input
        className={cn(
          "rounded-md border-none bg-transparent font-medium tracking-tight hover:bg-input/30 focus:bg-input/30 md:text-2xl",
          className
        )}
        {...props}
        id={id}
        type="text"
      />
    </>
  );
}
