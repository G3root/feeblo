import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { cn } from "./utils";

const WHITESPACE_REGEX = /\s+/;

export function getInitials(name: string | null | undefined): string {
  const normalized = name?.trim();

  if (!normalized) {
    return "??";
  }

  const segments = normalized.split(WHITESPACE_REGEX).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}

/**
 * The blue member tick, drawn on the avatar's bottom-right corner. It is
 * `aria-hidden` on its own: `memberLabel` is what a screen reader announces,
 * because a decorative tick on an image says nothing by itself.
 */
function MemberTick({
  label,
  size,
}: {
  label?: string | undefined;
  size: "sm" | "default" | "lg";
}) {
  return (
    <span
      className={cn(
        "bg-info ring-background absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full ring-2",
        size === "sm" && "size-3",
        size === "default" && "size-3.5",
        size === "lg" && "size-4"
      )}
      data-slot="member-tick"
    >
      <HugeiconsIcon
        aria-hidden="true"
        className="text-white"
        icon={Tick02Icon}
        size={9}
        strokeWidth={3}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export interface UserAvatarProps extends React.ComponentProps<typeof Avatar> {
  image?: string | null;
  imageAlt?: string;
  /**
   * Draws the blue member tick on the avatar. Set for people who belong to the
   * workspace (its members) so a reader can tell them apart from customers and
   * public-board accounts at a glance.
   */
  isMember?: boolean;
  /** Accessible label for the tick; omitted, the tick is purely decorative. */
  memberLabel?: string;
  name?: string | null;
}

export function UserAvatar({
  image,
  imageAlt,
  isMember = false,
  memberLabel,
  name,
  children,
  className,
  size = "default",
  ...props
}: UserAvatarProps): React.ReactElement {
  const avatar = (
    <Avatar className={className} size={size} {...props}>
      {image ? (
        <AvatarImage alt={imageAlt ?? name ?? "User avatar"} src={image} />
      ) : null}
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
      {children}
    </Avatar>
  );

  if (!isMember) {
    return avatar;
  }

  // The tick has to sit outside the avatar: `Avatar` clips its content with
  // `overflow-hidden`, so a badge inside it would be cut off at the corner.
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <MemberTick label={memberLabel} size={size} />
    </span>
  );
}
