import { Separator } from "@feeblo/ui/separator";
import { cn } from "@feeblo/ui/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * The dashboard's two-column editor shell: a document column and a sticky
 * sidebar of settings.
 *
 * Shared by the changelog and help center editors so the two surfaces cannot
 * drift into different page widths, paddings or sidebar behaviour.
 */
function Root({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]",
        className
      )}
    >
      {children}
    </div>
  );
}

function Main({ children, className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-8",
        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

function Header({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function HeaderContent({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-3", className)} {...props}>
      {children}
    </div>
  );
}

function Sidebar({ children, className, ...props }: ComponentProps<"aside">) {
  return (
    <aside className={cn("px-6 py-6", className)} {...props}>
      <div className="space-y-4 lg:sticky lg:top-0">{children}</div>
    </aside>
  );
}

function SidebarSeparator(props: ComponentProps<typeof Separator>) {
  return <Separator {...props} />;
}

export const EditorLayout = Object.assign(Root, {
  Header,
  HeaderContent,
  Main,
  Sidebar,
  SidebarSeparator,
});
