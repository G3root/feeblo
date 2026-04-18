import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function FeedbackBrowseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
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
        "grid min-w-0 gap-8",
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
  return <section className="min-w-0">{children}</section>;
}

export function FeedbackBrowseLayoutSidebar({
  children,
}: {
  children?: ReactNode;
}) {
  return <aside className="hidden lg:block">{children}</aside>;
}
