import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { initialDraft, type RegisterDraft } from "./register-draft";
import {
  type CreateWorkspacePayload,
  type CreateWorkspaceResult,
  type FinishWorkspacePayload,
  type FinishWorkspaceResult,
  createRegisterWizardMachine,
  toRegisterWizardView,
} from "./register-wizard-machine";

/**
 * The machine is the lifecycle, so these tests drive it the way the page does:
 * report whether the current step is answered, move, submit, and watch what
 * happens when the create is refused and when the logo or an invitation does
 * not land.
 *
 * The two calls are injected, so the interpreter, the invoke wiring and every
 * transition are the real ones.
 */

const draft = (overrides: Partial<RegisterDraft> = {}): RegisterDraft => ({
  ...initialDraft(),
  subdomain: "acme-labs",
  workspaceName: "Acme Labs",
  ...overrides,
});

type CreateMock = ReturnType<
  typeof vi.fn<
    (payload: CreateWorkspacePayload) => Promise<CreateWorkspaceResult>
  >
>;

type FinishMock = ReturnType<
  typeof vi.fn<
    (payload: FinishWorkspacePayload) => Promise<FinishWorkspaceResult>
  >
>;

const started = ({
  create = vi.fn<
    (payload: CreateWorkspacePayload) => Promise<CreateWorkspaceResult>
  >(async () => ({
    isFirstWorkspace: true,
    ok: true,
    organizationId: "org_1",
  })),
  finish = vi.fn<
    (payload: FinishWorkspacePayload) => Promise<FinishWorkspaceResult>
  >(async () => ({
    failedInvites: [],
    invited: [],
    logoUploaded: false,
  })),
}: {
  create?: CreateMock;
  finish?: FinishMock;
} = {}) => {
  const machine = createRegisterWizardMachine({
    createWorkspace: create,
    finishWorkspace: finish,
  });

  const actor = createActor(machine, {
    input: {
      stepIds: ["identity", "url", "boards", "team"] as const,
    },
  }).start();

  return { actor, create, finish };
};

const viewOf = (actor: ReturnType<typeof started>["actor"]) =>
  toRegisterWizardView(
    // SAFETY: this is the live actor's own snapshot, which carries the
    // `matches` and `context` this module reads.
    actor.getSnapshot() as Parameters<typeof toRegisterWizardView>[0]
  );

const answerStep = (actor: ReturnType<typeof started>["actor"]) =>
  actor.send({ type: "SYNC", canContinue: true });

const reachTeam = (actor: ReturnType<typeof started>["actor"]) => {
  for (let step = 0; step < 3; step += 1) {
    answerStep(actor);
    actor.send({ type: "NEXT" });
  }
};

describe("register wizard machine", () => {
  it("starts on the first step with nothing to continue to", () => {
    const { actor } = started();

    expect(viewOf(actor)).toMatchObject({
      canContinue: false,
      isBusy: false,
      stepId: "identity",
      stepIndex: 0,
      isLastStep: false,
    });
  });

  it("refuses to advance until the step is answered", () => {
    const { actor } = started();
    actor.send({ type: "NEXT" });

    expect(viewOf(actor).stepIndex).toBe(0);
  });

  it("drops the verdict when the step changes", () => {
    const { actor } = started();
    answerStep(actor);
    actor.send({ type: "NEXT" });

    // The next step has not been answered yet, whatever the last one said.
    expect(viewOf(actor)).toMatchObject({ canContinue: false, stepIndex: 1 });
  });

  it("walks forward and back, keeping the index in range", () => {
    const { actor } = started();

    reachTeam(actor);
    expect(viewOf(actor)).toMatchObject({
      isLastStep: true,
      stepId: "team",
      stepIndex: 3,
    });

    actor.send({ type: "BACK" });
    expect(viewOf(actor).stepId).toBe("boards");

    actor.send({ type: "GO_TO", index: 1 });
    expect(viewOf(actor).stepIndex).toBe(1);

    actor.send({ type: "GO_TO", index: 99 });
    expect(viewOf(actor).stepIndex).toBe(3);
  });

  it("creates the workspace with the answers, then reports it", async () => {
    const { actor, create, finish } = started();

    reachTeam(actor);
    actor.send({ type: "SUBMIT", draft: draft() });

    expect(viewOf(actor).isBusy).toBe(true);
    await vi.waitFor(() => expect(viewOf(actor).isDone).toBe(true));

    const payload = create.mock.calls[0]?.[0];

    expect(payload).toStrictEqual({
      boardNames: ["Bugs 🐞", "Features 💡"],
      subdomain: "acme-labs",
      workspaceName: "Acme Labs",
    });

    // Nothing to finish: no logo, no invitations.
    expect(finish).not.toHaveBeenCalled();
    expect(viewOf(actor).outcome).toMatchObject({
      isFirstWorkspace: true,
      organizationId: "org_1",
    });
  });

  it("finishes after the workspace exists when there is a logo or an invite", async () => {
    const { actor, finish } = started();

    reachTeam(actor);
    actor.send({
      type: "SUBMIT",
      draft: draft({ invites: ["", "teammate@example.com"] }),
    });

    await vi.waitFor(() => expect(viewOf(actor).isDone).toBe(true));

    const payload = finish.mock.calls[0]?.[0];

    // A blank row is not an invitation.
    expect(payload.invites).toStrictEqual(["teammate@example.com"]);
    expect(payload.organizationId).toBe("org_1");
  });

  it("keeps the answers when the create is refused", async () => {
    const create = vi.fn(async (): Promise<CreateWorkspaceResult> => ({
      message: "This address is already taken",
      ok: false,
    }));

    const { actor } = started({ create });

    reachTeam(actor);
    actor.send({ type: "SUBMIT", draft: draft() });

    await vi.waitFor(() => expect(viewOf(actor).isFailed).toBe(true));
    expect(viewOf(actor)).toMatchObject({
      error: "This address is already taken",
      isLastStep: true,
      stepId: "team",
    });

    // Submitting again from the failure retries the same answers.
    actor.send({ type: "SUBMIT", draft: draft() });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });

  it("treats a failed logo or invitation as a warning, not an error", async () => {
    const finish = vi.fn(async (): Promise<FinishWorkspaceResult> => ({
      failedInvites: ["taken@example.com"],
      invited: [],
      logoUploaded: false,
    }));

    const { actor } = started({ finish });

    reachTeam(actor);
    actor.send({
      type: "SUBMIT",
      draft: draft({ invites: ["taken@example.com"] }),
    });

    await vi.waitFor(() => expect(viewOf(actor).isDone).toBe(true));
    expect(viewOf(actor).isFailed).toBe(false);
    expect(viewOf(actor).outcome).toMatchObject({
      failedInvites: ["taken@example.com"],
      organizationId: "org_1",
    });
  });
});
