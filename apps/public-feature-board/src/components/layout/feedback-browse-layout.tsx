import { cn } from "@feeblo/ui/utils";
import type { ReactNode } from "react";

export function FeedbackBrowseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
      {children}
    </div>
  );
}

export function FeedbackBrowseLayoutContent({
  children,
  fullWidth,
}: {
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-0 min-w-0 flex-1 gap-8",
        fullWidth ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_220px]"
      )}
    >
      {children}
    </div>
  );
}

export function FeedbackBrowseLayoutMain({
  children,
}: {
  children: ReactNode;
}) {
  return <section className="min-h-0 min-w-0">{children}</section>;
}

export function FeedbackBrowseLayoutSidebar({
  children,
}: {
  children?: ReactNode;
}) {
  return <aside className="hidden lg:block">{children}</aside>;
}
