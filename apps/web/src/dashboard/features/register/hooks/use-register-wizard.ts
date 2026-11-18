import { useAppForm } from "@feeblo/ui/hooks/form";
import { useStore } from "@tanstack/react-store";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { createWorkspace } from "../lib/create-workspace";
import { finishWorkspace } from "../lib/finish-workspace";
import {
  registerStepIds,
  isStepComplete,
  initialDraft,
} from "../lib/register-draft";
import {
  type RegisterOutcome,
  createRegisterWizardMachine,
  toRegisterWizardView,
} from "../lib/register-wizard-machine";
import { registerFormOpts } from "../shared-form";
import { useSlugAvailability } from "./use-slug-availability";

const registerWizardMachine = createRegisterWizardMachine({
  createWorkspace,
  finishWorkspace,
});

/**
 * The register wizard: one form, one machine, one slug check.
 *
 * The form owns the answers and the machine owns where the reader is and
 * whether a request is in flight. `canContinue` is derived from the form during
 * render and sent with `NEXT`, so the button's state and the machine's decision
 * are the same value read once. Nothing is stored twice and no effect keeps two
 * copies in step: a step that arrives already answered (the boards step, whose
 * two defaults are complete on sight) needs no notification to become usable.
 */
export function useRegisterWizard({
  onCreated,
}: {
  readonly onCreated: (outcome: RegisterOutcome) => void;
}) {
  const [snapshot, send] = useMachine(registerWizardMachine, {
    input: { stepIds: registerStepIds },
  });

  const view = useMemo(() => toRegisterWizardView(snapshot), [snapshot]);

  const form = useAppForm(registerFormOpts);
  const values = useStore(form.store, (state) => state.values);
  const slug = useSlugAvailability(values.subdomain);

  const canContinue = useMemo(() => {
    if (view.stepId === null) {
      return false;
    }

    const answerIsComplete = isStepComplete(view.stepId, values);

    return view.stepId === "url"
      ? answerIsComplete && slug.availability.status === "available"
      : answerIsComplete;
  }, [slug.availability.status, values, view.stepId]);

  /**
   * The one effect left in the wizard, and it is a notification rather than a
   * derivation: the machine reaching `done` is the only signal that the route
   * should leave, and a route change is not an interaction any handler of ours
   * could sit on. The ref makes it fire once per workspace instead of once per
   * render of the terminal state.
   */
  const reportedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!view.isDone || view.outcome === null) {
      return;
    }

    if (reportedRef.current === view.outcome.organizationId) {
      return;
    }

    reportedRef.current = view.outcome.organizationId;
    onCreated(view.outcome);
  }, [onCreated, view.isDone, view.outcome]);

  const next = useCallback(
    () => send({ type: "NEXT", canContinue }),
    [canContinue, send]
  );

  const back = useCallback(() => send({ type: "BACK" }), [send]);

  const goTo = useCallback(
    (index: number) => send({ type: "GO_TO", index }),
    [send]
  );

  const retry = useCallback(() => send({ type: "EDIT" }), [send]);

  const submit = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  return {
    back,
    canContinue,
    form,
    goTo,
    next,
    retry,
    slug,
    submit,
    values,
    view,
  };
}

export type RegisterWizardState = ReturnType<typeof useRegisterWizard>;
