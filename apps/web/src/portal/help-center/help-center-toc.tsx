import { cn } from "@feeblo/ui/utils";
import type { MarkdownHeading } from "@feeblo/utils/markdown";
import { ChevronDownIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

/**
 * How far from the top of the viewport a heading counts as the one being read.
 *
 * A line rather than a ratio: the reader is at the top of a section once its
 * heading has arrived, and the rail should say so before the heading reaches the
 * very top of the window — the board's navbar occupies that space.
 */
const ACTIVE_LINE = 140;

const SCROLL_INTO_VIEW = { block: "start", inline: "nearest" } as const;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Jump to a section without leaving the page.
 *
 * `scrollIntoView` rather than a hash assignment: the board's scroll container
 * is the app shell's `main`, not the window, and an anchor's default navigation
 * scrolls the window. The hash is still replaced so the URL stays shareable.
 */
function jumpTo(id: string) {
  const heading = document.getElementById(id);

  if (heading === null) {
    return;
  }

  heading.scrollIntoView({
    ...SCROLL_INTO_VIEW,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });

  window.history.replaceState(null, "", `#${id}`);
}

/**
 * The id of the section the reader is currently in.
 *
 * Measured from each heading's own position rather than tracked by an
 * `IntersectionObserver`: sections can be shorter than the viewport, and an
 * observer would then report several of them at once with no rule for which one
 * wins. "The last heading above the line" is that rule.
 */
function useActiveHeading(headings: ReadonlyArray<MarkdownHeading>): string {
  const [active, setActive] = useState(headings[0]?.id ?? "");
  const frame = useRef(0);

  useEffect(() => {
    const update = () => {
      frame.current = 0;

      let current = headings[0]?.id ?? "";

      for (const heading of headings) {
        const element = document.getElementById(heading.id);

        if (
          element !== null &&
          element.getBoundingClientRect().top <= ACTIVE_LINE
        ) {
          current = heading.id;
        }
      }

      setActive(current);
    };

    const schedule = () => {
      if (frame.current === 0) {
        frame.current = window.requestAnimationFrame(update);
      }
    };

    update();

    // Capture phase, because the board scrolls inside the shell's `main` rather
    // than the window and a scroll on that element does not bubble.
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);

      if (frame.current !== 0) {
        window.cancelAnimationFrame(frame.current);
      }
    };
  }, [headings]);

  return active;
}

/**
 * "On this page", following the reader down the article.
 *
 * A nested list rather than a flat one: a section's subsections indent under it,
 * so the outline shows the document's shape and not only its headings.
 */
export function HelpCenterToc({
  headings,
  className,
}: {
  readonly headings: ReadonlyArray<MarkdownHeading>;
  readonly className?: string;
}) {
  const active = useActiveHeading(headings);

  if (headings.length === 0) {
    return null;
  }

  const top = Math.min(...headings.map((heading) => heading.level));

  return (
    <nav aria-label="On this page" className={className}>
      <p className="mb-3 text-xs font-medium">On this page</p>
      <ul className="border-border/70 flex flex-col border-s">
        {headings.map((heading) => {
          const isActive = heading.id === active;

          return (
            <li key={heading.id}>
              <a
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "-ms-px block border-s py-1 pe-2 text-[13px] leading-5 transition-colors",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                )}
                href={`#${heading.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  jumpTo(heading.id);
                }}
                style={{
                  paddingInlineStart: `${0.75 + (heading.level - top) * 0.75}rem`,
                }}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The same outline, folded into a disclosure for the screens with no rail.
 *
 * `<details>` rather than a `Collapsible`: there is no state to own here, no
 * animation to coordinate with a sibling panel, and the native element brings
 * keyboard support and find-in-page expansion for free.
 */
export function HelpCenterOutlineDisclosure({
  headings,
  className,
}: {
  readonly headings: ReadonlyArray<MarkdownHeading>;
  readonly className?: string;
}) {
  if (headings.length < 2) {
    return null;
  }

  const top = Math.min(...headings.map((heading) => heading.level));

  return (
    <details
      className={cn(
        "group border-border/70 rounded-xl border [&[open]>summary_svg]:rotate-180",
        className
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        On this page
        <HugeiconsIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform"
          icon={ChevronDownIcon}
        />
      </summary>
      <ul className="border-border/70 border-t px-2 py-2">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex min-h-10 items-center rounded-lg pe-2 text-sm transition-colors"
              href={`#${heading.id}`}
              onClick={(event) => {
                event.preventDefault();
                jumpTo(heading.id);
              }}
              style={{
                paddingInlineStart: `${0.5 + (heading.level - top) * 0.75}rem`,
              }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
