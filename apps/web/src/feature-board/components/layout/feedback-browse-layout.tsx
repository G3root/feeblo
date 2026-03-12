import type { ReactNode } from "react";

export function FeedbackBrowseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {children}
    </div>
  );
}

export function FeedbackBrowseLayoutContent({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      {children}
    </div>
  );
}

export function FeedbackBrowseLayoutMain({
  children,
}: {
  children: ReactNode;
}) {
  return <section className="space-y-6">{children}</section>;
}

export function FeedbackBrowseLayoutSidebar({
  children,
}: {
  children?: ReactNode;
}) {
  return <aside className="space-y-4">{children}</aside>;
}
