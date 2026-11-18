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
 * whether a request is in flight. The two are bridged by a single derived
 * boolean: `isStepComplete` for the current step, plus the check's verdict on
 * the url step. That verdict is reported to the machine as an event, so `NEXT`
 * never has to read the form and the machine can be tested without one.
 *
 * The bridge is an effect on purpose. The form store changes outside React's
 * render cycle, and the machine needs the newest answer before the next click,
 * not after the next paint; the dependency is a boolean, so the effect runs
 * when the answer changes and not on every keystroke.
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

  // The verdict is per step, so the machine never needs to be told again when
  // the reader walks back to an answered one. This effect only reports a change
  // in the current answer, and its dependency is a boolean.
  useEffect(() => {
    send({ type: "SYNC", canContinue });
  }, [canContinue, send]);

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

  const next = useCallback(() => send({ type: "NEXT" }), [send]);
  const back = useCallback(() => send({ type: "BACK" }), [send]);

  const goTo = useCallback(
    (index: number) => send({ type: "GO_TO", index }),
    [send]
  );

  const retry = useCallback(() => send({ type: "EDIT" }), [send]);

  const submit = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  return { back, form, goTo, next, retry, slug, submit, values, view };
}

export type RegisterWizardState = ReturnType<typeof useRegisterWizard>;
