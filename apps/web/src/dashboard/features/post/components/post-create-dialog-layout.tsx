import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

type PostCreateRootProps = ComponentProps<"form">;
type PostCreateDivProps = ComponentProps<"div">;
type PostCreateAsideProps = ComponentProps<"aside">;

function Root({ children, className, ...props }: PostCreateRootProps) {
  return (
    <form
      className={cn(
        "flex h-full flex-col gap-4 md:flex-row md:items-start",
        className
      )}
      {...props}
    >
      {children}
    </form>
  );
}

function Main({ children, className, ...props }: PostCreateDivProps) {
  return (
    <div className={cn("flex h-full flex-1 flex-col gap-2", className)} {...props}>
      {children}
    </div>
  );
}

function Sidebar({ children, className, ...props }: PostCreateAsideProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col rounded-xl border bg-muted/40 p-3 text-sm md:min-h-150 md:w-sm md:p-4",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

function SidebarBody({ children, className, ...props }: PostCreateDivProps) {
  return (
    <div className={cn("flex flex-1 flex-col gap-4", className)} {...props}>
      {children}
    </div>
  );
}

function PropertyList({ children, className, ...props }: PostCreateDivProps) {
  return (
    <div className={cn("flex-1 space-y-1.5", className)} {...props}>
      {children}
    </div>
  );
}

function Actions({ children, className, ...props }: PostCreateDivProps) {
  return (
    <div
      className={cn("mt-auto flex items-center justify-between pt-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export const PostCreateLayout = Object.assign(Root, {
  Actions,
  Main,
  PropertyList,
  Sidebar,
  SidebarBody,
});
