import type { ReactNode } from "react";
import { Navbar } from "../common/navbar";

export function PublicBoardShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>{children}</main>
    </div>
  );
}
