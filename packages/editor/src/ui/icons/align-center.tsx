import type { IconProps } from "./types";

export function AlignCenterIcon({ size, width, height, ...props }: IconProps) {
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
      <path d="M21 5H3" />
      <path d="M17 12H7" />
      <path d="M19 19H5" />
    </svg>
  );
}
