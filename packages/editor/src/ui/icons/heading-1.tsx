import type { IconProps } from "./types";

export function Heading1Icon({ size, width, height, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size ?? height ?? 24}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size ?? width ?? 24}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="m17 12 3-2v8" />
    </svg>
  );
}
