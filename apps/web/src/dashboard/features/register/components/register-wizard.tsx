import { Alert, AlertDescription } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";

import type { RegisterWizardState } from "../hooks/use-register-wizard";
import { registerStepIds, type RegisterStepId } from "../lib/register-draft";
import { BoardsStep } from "./register-steps/boards-step";
import { IdentityStep } from "./register-steps/identity-step";
import { TeamStep } from "./register-steps/team-step";
import { UrlStep } from "./register-steps/url-step";

/**
 * The step copy. Short on purpose: each step asks one question and the field
 * labels carry the detail.
 */
const stepCopy: Record<RegisterStepId, { description: string; title: string }> =
  {
    identity: {
      description:
        "This is the workspace your team and your customers will see.",
      title: "Name your workspace",
    },
    url: {
      description: "Your public board lives at this address.",
      title: "Choose your address",
    },
    boards: {
      description: "Boards are where feedback lands.",
      title: "Pick your first boards",
    },
    team: {
      description: "Optional. You can invite people later.",
      title: "Bring your team",
    },
  };

/**
 * The wizard's frame: the rail, the current question, and the one button that
 * moves forward.
 *
 * It renders the form it is given rather than creating one, so the page owns
 * the answers and this file only decides what to show. The rail is a progress
 * indicator, not a set of links: a reader who could jump ahead would reach the
 * last step with an address nobody checked.
 */
export function RegisterWizard({ wizard }: { wizard: RegisterWizardState }) {
  const { form, view } = wizard;
  const stepId = view.stepId;
  const copy = stepId === null ? null : stepCopy[stepId];

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (view.isLastStep) {
          wizard.submit();
        } else {
          wizard.next();
        }
      }}
    >
      <div aria-hidden className="flex items-center gap-1.5">
        {registerStepIds.map((id, index) => (
          <span
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              index === view.stepIndex
                ? "bg-primary w-8"
                : index < view.stepIndex
                  ? "bg-primary/50 w-3"
                  : "bg-muted-foreground/25 w-3"
            )}
            key={id}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          {copy?.title ?? "Create your workspace"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {copy?.description ?? "One more moment."}
        </p>
      </div>

      {stepId === "identity" ? <IdentityStep form={form} /> : null}
      {stepId === "url" ? <UrlStep form={form} /> : null}
      {stepId === "boards" ? <BoardsStep form={form} /> : null}
      {stepId === "team" ? <TeamStep form={form} /> : null}

      {view.isFailed ? (
        <Alert variant="error">
          <AlertDescription>{view.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {view.stepIndex > 0 ? (
          <Button
            disabled={view.isBusy}
            onClick={wizard.back}
            type="button"
            variant="ghost"
          >
            Back
          </Button>
        ) : (
          <span />
        )}

        <Button
          disabled={view.isBusy || (!view.isLastStep && !wizard.canContinue)}
          loading={view.isBusy}
          type="submit"
        >
          {view.isLastStep ? "Create workspace" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

/** Re-exported so the page can pass the wizard without importing the hook. */
export type { RegisterWizardState };
