import type { IconProps } from "./types";

export function Rows2Icon({ size, width, height, ...props }: IconProps) {
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
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M3 12h18" />
    </svg>
  );
}
