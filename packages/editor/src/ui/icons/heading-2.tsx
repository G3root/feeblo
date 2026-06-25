import type { IconProps } from "./types";

export function Heading2Icon({ size, width, height, ...props }: IconProps) {
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
      <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
    </svg>
  );
}
