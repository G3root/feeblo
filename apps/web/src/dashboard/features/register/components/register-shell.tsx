import { cn } from "@feeblo/ui/utils";
import type React from "react";

import { Heading, Body, Actions } from "./register-shell-parts";

type RootProps = {
  children: React.ReactNode;
  className?: string;
};

function Root({ children, className }: RootProps) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex min-h-svh w-full flex-col items-center justify-center px-4 py-12",
        className
      )}
    >
      <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
    </div>
  );
}

export const RegisterShell = Object.assign(Root, {
  Heading,
  Body,
  Actions,
});
