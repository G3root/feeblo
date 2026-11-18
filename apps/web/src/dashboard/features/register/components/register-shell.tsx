import { cn } from "@feeblo/ui/utils";
import type React from "react";

type RootProps = {
  children: React.ReactNode;
  className?: string;
  /**
   * The workspace the form is describing, shown beside it on a wide screen.
   *
   * Optional because only some of the page's states have a workspace to
   * preview: the loading card and the workspace-limit card are about the
   * account, not about the workspace being created, and a preview there would
   * picture something the reader cannot have.
   */
  preview?: React.ReactNode;
};

/**
 * The register page's frame.
 *
 * A full-screen split rather than a card on a tinted background: the form and
 * the workspace it is describing are two views of one thing, and giving each
 * half the viewport is what makes the preview read as the product the reader
 * is about to get instead of an illustration of it. The preview half is
 * height-locked to the viewport so it never scrolls the page. The preview owns
 * its own insets — it draws a page that runs off the right and bottom edges, so
 * a gutter here would cut it twice.
 *
 * Without a preview the page falls back to a centred column: the loading and
 * limit states have nothing to show on the right, and a half-empty split would
 * put the card off-centre for no reason.
 */
function Root({ children, className, preview }: RootProps) {
  if (preview === undefined) {
    return (
      <div
        className={cn(
          "bg-muted/40 flex min-h-svh w-full items-center justify-center px-4 py-12",
          className
        )}
      >
        <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-h-svh w-full grid-cols-1 lg:h-svh lg:grid-cols-2",
        className
      )}
    >
      <div className="flex items-center justify-center overflow-y-auto px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
      </div>

      <div className="bg-muted/40 hidden min-h-0 lg:block">{preview}</div>
    </div>
  );
}

export { Root as RegisterShell };
