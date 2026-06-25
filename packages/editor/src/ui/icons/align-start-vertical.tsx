import type { IconProps } from "./types";

export function AlignStartVerticalIcon({
  size,
  width,
  height,
  ...props
}: IconProps) {
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
      <rect height="6" rx="2" width="9" x="6" y="14" />
      <rect height="6" rx="2" width="16" x="6" y="4" />
      <path d="M2 2v20" />
    </svg>
  );
}
