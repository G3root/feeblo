import { Separator } from "@feeblo/ui/separator";
import { cn } from "@feeblo/ui/utils";
import type { ComponentProps } from "react";

type ChangelogEditorSectionProps = ComponentProps<"section">;
type ChangelogEditorAsideProps = ComponentProps<"aside">;
type ChangelogEditorDivProps = ComponentProps<"div">;

export function Main({
  children,
  className,
  ...props
}: ChangelogEditorSectionProps) {
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
export function Header({
  children,
  className,
  ...props
}: ChangelogEditorDivProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}
export function HeaderContent({
  children,
  className,
  ...props
}: ChangelogEditorDivProps) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-3", className)} {...props}>
      {children}
    </div>
  );
}
export function Sidebar({
  children,
  className,
  ...props
}: ChangelogEditorAsideProps) {
  return (
    <aside className={cn("px-6 py-6", className)} {...props}>
      <div className="space-y-4 lg:sticky lg:top-0">{children}</div>
    </aside>
  );
}
export function SidebarSeparator(props: ComponentProps<typeof Separator>) {
  return <Separator {...props} />;
}
