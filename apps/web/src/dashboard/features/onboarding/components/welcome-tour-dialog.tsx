import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { cn } from "@feeblo/ui/utils";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import type { WelcomeTour } from "../hooks/use-welcome-tour";
import type { WelcomeTourStep } from "./tour-steps";

/**
 * The welcome tour, as a dialog.
 *
 * Presentational: every state it renders comes from the machine through
 * `tour`, and every action it offers is one of the machine's events. That is
 * what keeps the two facts this dialog has to agree with itself about — which
 * step is showing, and whether the reader is on the last one — from drifting
 * apart, which is what happened when they were two `useState` values.
 *
 * Keyboard handling is arrows only. Enter is deliberately not handled: the
 * focused button already answers it, and a window listener that also advanced
 * on Enter would step twice for one key press — from the keyboard *and* from
 * the button's own click.
 */
export function WelcomeTourDialog({
  steps,
  tour,
}: {
  readonly steps: readonly WelcomeTourStep[];
  readonly tour: WelcomeTour;
}) {
  const { view } = tour;
  const stepIndex = Math.min(view.stepIndex, steps.length - 1);
  const step = steps[stepIndex];

  useEffect(() => {
    if (!view.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        tour.next();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        tour.back();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tour, view.open]);

  if (step === undefined) {
    return null;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          tour.close();
        }
      }}
      open={view.open}
    >
      <DialogPopup
        className="max-w-md overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* The plate: one product object, on the surface colour. Tall enough
            for a lane or a post row at the size the product draws them, so the
            detail is the shape the reader meets on their own board rather than
            a diagram of it. */}
        <div className="bg-muted/60 flex h-44 shrink-0 items-center justify-center overflow-hidden border-b px-6 dark:bg-black/30">
          <div
            className="ease-out-strong flex w-full justify-center transition-[opacity,translate] duration-200 motion-reduce:transition-opacity starting:translate-y-1 starting:opacity-0"
            key={step.id}
          >
            {step.detail}
          </div>
        </div>

        <div
          className="ease-out-strong flex flex-col gap-2 px-6 py-5 transition-[opacity,translate] duration-200 motion-reduce:transition-opacity starting:translate-y-1 starting:opacity-0"
          key={`${step.id}-copy`}
        >
          <DialogTitle className="text-lg">{step.title}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {step.description}
          </DialogDescription>
        </div>

        <DialogFooter
          className="items-center justify-between gap-3"
          variant="default"
        >
          <div className="flex items-center gap-1.5">
            {steps.map((entry, index) => (
              <button
                aria-current={index === stepIndex ? "step" : undefined}
                aria-label={`Go to step ${index + 1}: ${entry.title}`}
                className={cn(
                  "h-1.5 cursor-pointer rounded-full transition-all duration-300",
                  index === stepIndex
                    ? "bg-primary w-6"
                    : index < stepIndex
                      ? "bg-primary/50 w-1.5"
                      : "bg-muted-foreground/25 hover:bg-muted-foreground/40 w-1.5"
                )}
                key={entry.id}
                onClick={() => tour.goTo(index)}
                type="button"
              />
            ))}
            <span className="text-muted-foreground ml-2 text-[11px] tabular-nums">
              {stepIndex + 1} of {steps.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {view.canGoBack ? (
              <Button
                onClick={tour.back}
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon
                  className="size-4 opacity-60"
                  icon={ArrowLeft01Icon}
                />
                Back
              </Button>
            ) : (
              <Button
                onClick={tour.close}
                size="sm"
                type="button"
                variant="ghost"
              >
                Skip
              </Button>
            )}

            <Button onClick={tour.next} size="sm" type="button">
              {view.isLastStep ? "Get started" : "Continue"}
              {view.isLastStep ? null : (
                <HugeiconsIcon
                  className="size-4 opacity-60"
                  icon={ArrowRight01Icon}
                />
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
