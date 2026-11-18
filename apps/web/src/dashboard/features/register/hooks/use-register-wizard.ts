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
  /**
   * Called once the machine is done. It may be async: leaving the page before
   * the session names the new workspace lands the reader back on this route.
   */
  readonly onCreated: (outcome: RegisterOutcome) => Promise<void> | void;
}) {
  const [snapshot, send] = useMachine(registerWizardMachine, {
    input: { stepIds: registerStepIds },
  });

  const view = useMemo(() => toRegisterWizardView(snapshot), [snapshot]);

  const form = useAppForm({
    ...registerFormOpts,
    // The one place the form and the machine meet on the way in. Without it
    // `handleSubmit` validates and returns: the button would look like it
    // worked and no create request would ever leave the page.
    onSubmit: ({ value }) => {
      send({ type: "SUBMIT", draft: value });
    },
  });

  const values = useStore(form.store, (state) => state.values);

  // The same rule `CreateWorkspace` applies before it uses the address. The
  // check has to judge the string the server will, or a stray capital or a
  // trailing space makes the field claim an address the create then refuses.
  const subdomain = useMemo(
    () => values.subdomain.trim().toLowerCase(),
    [values.subdomain]
  );

  const slug = useSlugAvailability(subdomain);

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
    void onCreated(view.outcome);
  }, [onCreated, view.isDone, view.outcome]);

  const next = useCallback(
    () => send({ type: "NEXT", canContinue }),
    [canContinue, send]
  );

  const back = useCallback(() => {
    // A create refused with an address conflict means the address the field
    // called free is not. Back is the only way the reader leaves that state, so
    // it is also the moment to ask again: the string is unchanged, and the
    // check's own input event would ignore it.
    if (view.isFailed) {
      slug.recheck();
    }

    send({ type: "BACK" });
  }, [send, slug, view.isFailed]);

  const goTo = useCallback(
    (index: number) => send({ type: "GO_TO", index }),
    [send]
  );

  const submit = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  return {
    back,
    canContinue,
    form,
    goTo,
    next,
    slug,
    submit,
    values,
    view,
  };
}

export type RegisterWizardState = ReturnType<typeof useRegisterWizard>;
