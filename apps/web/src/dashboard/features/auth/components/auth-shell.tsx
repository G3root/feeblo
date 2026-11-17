import type { ReactNode, Ref } from "react";

import { AuthPanel } from "./auth-panel";
import { BrandLockup } from "./brand-mark";

type AuthShellProps = {
  children: ReactNode;
  description: string;
  footer?: ReactNode;
  title: string;
  /** Optional ref to the heading, used to move focus on step changes. */
  titleRef?: Ref<HTMLHeadingElement>;
};

/**
 * The frame every signed-out auth page shares: sign in, sign up, password
 * recovery, and the invitation screen.
 *
 * There is no card. The form sits directly on the page, which is the whole
 * point of the layout: a bordered box around three fields on an otherwise
 * empty canvas reads as a widget someone dropped on the page, and it forces
 * every element inside it into the same narrow column. Removing the box leaves
 * the type doing the framing — a large heading, a quiet description, and a
 * fixed 22rem measure that keeps the form narrow regardless of the box.
 *
 * `lg` splits the page in two: the form on the left, and a panel on the right
 * that shows the product (see `AuthPanel`). Below `lg` the panel is gone, so
 * the form is a single centred column with the wordmark above it. The heading
 * is an `h1` with a ref because the password-recovery flow moves focus to it
 * between steps; a decorative heading with no focus target strands keyboard
 * and screen-reader users on a page whose content just replaced itself.
 */
export function AuthShell({
  children,
  description,
  footer,
  title,
  titleRef,
}: AuthShellProps) {
  return (
    <div className="bg-background grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-svh flex-col px-6 sm:px-10">
        <header className="flex h-16 shrink-0 items-center">
          <BrandLockup />
        </header>

        {/* `pb-16` cancels the header's height so the form centres on the
            viewport rather than 32px below its middle. */}
        <main className="flex flex-1 items-center justify-center pb-8 sm:pb-16">
          <div className="motion-safe:animate-rise-in w-full max-w-[22rem]">
            <h1
              className="text-foreground text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.022em] text-balance"
              ref={titleRef}
              tabIndex={-1}
            >
              {title}
            </h1>
            <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
              {description}
            </p>

            {/* A column so that a screen passing two siblings (the
                invitation flow's alert and its button) keeps the rhythm the
                shared form spacing gives everything else. */}
            <div className="mt-8 flex flex-col gap-4">{children}</div>

            {footer === null || footer === undefined ? null : (
              <div className="text-muted-foreground mt-7 text-[13px]">
                {footer}
              </div>
            )}
          </div>
        </main>
      </div>

      <AuthPanel className="lg:min-h-svh" />
    </div>
  );
}
