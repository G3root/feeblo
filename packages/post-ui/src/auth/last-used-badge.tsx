import { cn } from "@feeblo/ui/utils";

/**
 * The "last used" tag that sits on the corner of an auth button.
 *
 * It exists to shorten the decision at the top of the sign-in page: two social
 * buttons and an email form all look equally plausible, and the one that
 * worked last time is almost always the one that works this time.
 *
 * Absolute rather than inline, because an inline tag widens one button and
 * leaves the pair below it a different width. The trigger has to keep
 * `overflow-visible` for it to paint outside the border, which every button
 * variant here already does.
 */
export function LastUsedBadge({
  className,
  tone = "default",
}: {
  className?: string;
  /**
   * `onBrand` is for the filled brand button: the default tag is brand on
   * brand and disappears into it, so it inverts to a white chip.
   */
  tone?: "default" | "onBrand";
}) {
  return (
    <span
      // Hidden from assistive technology: it decorates a button whose name is
      // the action ("Continue with Google"), and appending "Last used" to that
      // name changes what the control is called for a sighted-label reason.
      aria-hidden
      className={cn(
        "pointer-events-none absolute -top-2 right-2 rounded-md px-1.5 py-1 text-[10px] leading-none font-medium whitespace-nowrap select-none",
        // The hint is read from storage after mount, so the tag is inserted
        // into a button that is already painted. Without this it appears in one
        // hard frame; `starting:` gives it the 6px arrival every other
        // late-arriving surface here gets.
        "ease-out-strong transition-[opacity,translate] duration-200 motion-reduce:transition-opacity starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        tone === "onBrand"
          ? "bg-brand-foreground text-brand"
          : "bg-brand text-brand-foreground",
        className
      )}
      data-slot="last-used-badge"
    >
      Last used
    </span>
  );
}
