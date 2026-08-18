import { cn } from "@feeblo/ui/utils";
import type { ReactNode } from "react";

import {
  Main,
  Header,
  HeaderContent,
  Sidebar,
  SidebarSeparator,
} from "./changelog-editor-layout-parts";

type ChangelogEditorRootProps = {
  children: ReactNode;
  className?: string;
};

function Root({ children, className }: ChangelogEditorRootProps) {
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

export const ChangelogEditor = Object.assign(Root, {
  Main,
  Header,
  HeaderContent,
  Sidebar,
  SidebarSeparator,
});
