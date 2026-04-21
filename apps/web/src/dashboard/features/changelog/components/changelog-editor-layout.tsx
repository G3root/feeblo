import type { ComponentProps, ReactNode } from "react";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";

type ChangelogEditorRootProps = {
  children: ReactNode;
  className?: string;
};

type ChangelogEditorSectionProps = ComponentProps<"section">;
type ChangelogEditorAsideProps = ComponentProps<"aside">;
type ChangelogEditorDivProps = ComponentProps<"div">;
type ChangelogEditorMetadataProps = {
  label: string;
  value: ReactNode;
};

function Root({ children, className }: ChangelogEditorRootProps) {
  return (
    <div className={cn("mx-auto w-full", className)}>
      <div className="grid gap-6">{children}</div>
    </div>
  );
}

function Main({ children, className, ...props }: ChangelogEditorSectionProps) {
  return (
    <section
      className={cn("space-y-6 px-4 py-6 md:px-6 md:py-8", className)}
      {...props}
    >
      {children}
    </section>
  );
}

function Header({ children, className, ...props }: ChangelogEditorDivProps) {
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
}: ChangelogEditorDivProps) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-3", className)} {...props}>
      {children}
    </div>
  );
}

function Sidebar({ children, className, ...props }: ChangelogEditorAsideProps) {
  return (
    <aside
      className={cn(
        "h-fit space-y-4 border-l bg-muted/20 p-4 md:p-6",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

function SidebarSection({
  children,
  className,
  ...props
}: ChangelogEditorDivProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {children}
    </div>
  );
}

function MetadataList({
  children,
  className,
  ...props
}: ChangelogEditorDivProps) {
  return (
    <div className={cn("space-y-3 text-sm", className)} {...props}>
      {children}
    </div>
  );
}

function MetadataRow({ label, value }: ChangelogEditorMetadataProps) {
  return (
    <SidebarSection>
      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
        {label}
      </p>
      <div className="text-sm">{value}</div>
    </SidebarSection>
  );
}

function SidebarSeparator(props: ComponentProps<typeof Separator>) {
  return <Separator {...props} />;
}

export const ChangelogEditor = Object.assign(Root, {
  Main,
  Header,
  HeaderContent,
  Sidebar,
  SidebarSection,
  SidebarSeparator,
  MetadataList,
  MetadataRow,
});
