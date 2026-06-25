import type { IconProps } from "./types";

export function SquareCodeIcon({ size, width, height, ...props }: IconProps) {
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
      <path d="m10 9-3 3 3 3" />
      <path d="m14 15 3-3-3-3" />
      <rect height="18" rx="2" width="18" x="3" y="3" />
    </svg>
  );
}
