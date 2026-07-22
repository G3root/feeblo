import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import type React from "react";

const WHITESPACE_REGEX = /\s+/;

export function getInitials(name: string | null | undefined): string {
  const normalized = name?.trim();

  if (!normalized) {
    return "??";
  }

  const segments = normalized.split(WHITESPACE_REGEX).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}

export interface UserAvatarProps extends React.ComponentProps<typeof Avatar> {
  image?: string | null;
  imageAlt?: string;
  name?: string | null;
}

export function UserAvatar({
  image,
  imageAlt,
  name,
  children,
  ...props
}: UserAvatarProps): React.ReactElement {
  return (
    <Avatar {...props}>
      {image ? <AvatarImage alt={imageAlt ?? name ?? "User avatar"} src={image} /> : null}
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
      {children}
    </Avatar>
  );
}
