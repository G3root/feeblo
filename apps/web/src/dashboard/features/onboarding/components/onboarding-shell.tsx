import type React from "react";
import { cn } from "~/lib/utils";

type RootProps = {
  children: React.ReactNode;
  className?: string;
};

type HeadingProps = {
  title: string;
  description: string;
};

type SectionProps = {
  children: React.ReactNode;
  className?: string;
};

function Root({ children, className }: RootProps) {
  return (
    <section
      className={cn(
        "mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-10",
        className
      )}
    >
      {children}
    </section>
  );
}

function Heading({ title, description }: HeadingProps) {
  return (
    <header className="space-y-1 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{description}</p>
    </header>
  );
}

function Body({ children, className }: SectionProps) {
  return <div className={cn("space-y-4", className)}>{children}</div>;
}

function Actions({ children, className }: SectionProps) {
  return <div className={cn("flex flex-col gap-2", className)}>{children}</div>;
}

export const OnboardingShell = Object.assign(Root, {
  Heading,
  Body,
  Actions,
});
