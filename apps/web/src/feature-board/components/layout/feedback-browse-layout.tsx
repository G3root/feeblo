import type { ReactNode } from "react";

export function FeedbackBrowseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
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
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
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
