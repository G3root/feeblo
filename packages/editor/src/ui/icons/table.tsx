import type { IconProps } from "./types";

export function TableIcon({ size, width, height, ...props }: IconProps) {
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
      <path d="M12 3v18" />
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  );
}
