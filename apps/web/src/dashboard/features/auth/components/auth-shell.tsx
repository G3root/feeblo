import { Card, CardHeader, CardPanel, CardTitle } from "@feeblo/ui/card";
import type { ReactNode, Ref } from "react";

type AuthShellProps = {
  children: ReactNode;
  description: string;
  footer: ReactNode;
  title: string;
  /** Optional ref to the page heading, used to move focus on step changes. */
  titleRef?: Ref<HTMLDivElement>;
};

export function AuthShell({
  children,
  description,
  footer,
  title,
  titleRef,
}: AuthShellProps) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl" ref={titleRef} tabIndex={-1}>
              {title}
            </CardTitle>
            <p className="text-muted-foreground text-sm">{description}</p>
          </CardHeader>
          <CardPanel>
            <div className="flex flex-col gap-4">
              {children}
              {footer}
            </div>
          </CardPanel>
        </Card>
      </div>
    </div>
  );
}
