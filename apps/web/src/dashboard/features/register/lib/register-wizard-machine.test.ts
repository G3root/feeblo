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

const next = (
  actor: ReturnType<typeof started>["actor"],
  canContinue = true
) => {
  actor.send({ type: "NEXT", canContinue });
};

const reachTeam = (actor: ReturnType<typeof started>["actor"]) => {
  for (let step = 0; step < 3; step += 1) {
    next(actor);
  }
};

describe("register wizard machine", () => {
  it("starts on the first step", () => {
    const { actor } = started();

    expect(viewOf(actor)).toMatchObject({
      isBusy: false,
      stepId: "identity",
      stepIndex: 0,
      isLastStep: false,
    });
  });

  it("refuses to advance when the event says the step is not answered", () => {
    const { actor } = started();
    next(actor, false);

    expect(viewOf(actor).stepIndex).toBe(0);
  });

  it("walks back to a step without being told again", () => {
    const { actor } = started();

    next(actor);
    next(actor);
    actor.send({ type: "BACK" });

    // The machine holds no answer of its own, so there is nothing to forget:
    // the page derives the answer for whichever step is showing.
    expect(viewOf(actor)).toMatchObject({ stepId: "url", stepIndex: 1 });
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

  it("lets Back leave a failed create, one step back", async () => {
    const create = vi.fn(async (): Promise<CreateWorkspaceResult> => ({
      message: "This address is already taken",
      ok: false,
    }));

    const { actor } = started({ create });

    reachTeam(actor);
    actor.send({ type: "SUBMIT", draft: draft() });
    await vi.waitFor(() => expect(viewOf(actor).isFailed).toBe(true));

    actor.send({ type: "BACK" });

    // The address is the thing that was refused, and it is one step back. The
    // answers are still in the form; the machine only moves.
    expect(viewOf(actor)).toMatchObject({
      error: null,
      isFailed: false,
      stepId: "boards",
      stepIndex: 2,
    });
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
