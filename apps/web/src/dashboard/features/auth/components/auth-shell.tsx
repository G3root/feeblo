import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@feeblo/ui/card";

type AuthShellProps = {
  children: ReactNode;
  description: string;
  footer: ReactNode;
  title: string;
};

export function AuthShell({
  children,
  description,
  footer,
  title,
}: AuthShellProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">{title}</CardTitle>
            <p className="text-muted-foreground text-sm">{description}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {children}
              {footer}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
