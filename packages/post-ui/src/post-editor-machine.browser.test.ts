import { describe, expect, it } from "vitest";
import { createActor, transition } from "xstate";

import {
  type PostEditorSnapshot,
  postEditorMachine,
  toPostEditorState,
} from "./post-editor-machine";

/**
 * The graph has no timers and no invoked children, so these tests read it
 * through `transition()` against a resolved snapshot — the same view the
 * component has, without an interpreter. The one test that pins the configured
 * initial state starts a real actor, because `resolveState` would only assert a
 * snapshot the test built rather than the machine's own `initial` and
 * `context`.
 *
 * `RELOAD_LATEST` and `KEEP_DRAFT` are the two buttons on the conflict panel.
 * They differ by exactly one thing — whether the editor remounts — and that is
 * what `editorKey` counts, so the pair is asserted together.
 */

const V1 = new Date("2024-01-01T00:00:00.000Z");
const V2 = new Date("2024-01-02T00:00:00.000Z");
const V3 = new Date("2024-01-03T00:00:00.000Z");

type EditorValue = "conflict" | "editing" | "loading";

const at = (value: EditorValue, version: Date | undefined, reloads = 0) =>
  postEditorMachine.resolveState({ context: { reloads, version }, value });

const stateOf = (snapshot: ReturnType<typeof at>) =>
  toPostEditorState(
    // SAFETY: this is a machine snapshot, which carries the `matches` and
    // `context` this module reads; the structural type exists only because
    // `@xstate/react` widens the snapshot's `status`.
    snapshot as PostEditorSnapshot
  );

const step = (
  from: ReturnType<typeof at>,
  event: Parameters<typeof transition<typeof postEditorMachine>>[2]
) => transition(postEditorMachine, from, event)[0];

describe("post editor machine", () => {
  it("starts loading with no version to save against", () => {
    const actor = createActor(postEditorMachine).start();
    try {
      expect(stateOf(actor.getSnapshot())).toStrictEqual({
        editorKey: 0,
        status: "loading",
        version: undefined,
      });
    } finally {
      actor.stop();
    }
  });

  it("pins the version the editor was opened with", () => {
    const next = step(at("loading", undefined), {
      type: "VERSION_AVAILABLE",
      version: V1,
    });

    expect(stateOf(next)).toStrictEqual({
      editorKey: 0,
      status: "editing",
      version: V1,
    });
  });

  it("ignores a background refresh once the draft is pinned", () => {
    // The rule the old effect spelled out as `draftVersion === undefined`: a
    // refresh that loads a newer row must not move the version under a mounted
    // draft, because the next save would then overwrite content the user never
    // saw.
    const before = at("editing", V1);
    const next = step(before, { type: "VERSION_AVAILABLE", version: V2 });

    expect(next).toBe(before);
  });

  it("adopts the saved version without leaving the editing state", () => {
    const next = step(at("editing", V1), { type: "SAVED", version: V2 });

    expect(stateOf(next)).toStrictEqual({
      editorKey: 0,
      status: "editing",
      version: V2,
    });
  });

  it("keeps the pinned version when the save produced no read-back", () => {
    // The save succeeded, so the draft is no longer in conflict; there is just
    // nothing newer to pin to.
    const next = step(at("editing", V1), { type: "SAVED", version: undefined });

    expect(stateOf(next)).toStrictEqual({
      editorKey: 0,
      status: "editing",
      version: V1,
    });
  });

  it("enters the conflict state when the server moved", () => {
    const next = step(at("editing", V1), { type: "CONFLICT" });

    expect(stateOf(next).status).toBe("conflict");
    expect(stateOf(next).version).toBe(V1);
  });

  it("cannot conflict before a version is pinned", () => {
    const before = at("loading", undefined);
    const next = step(before, { type: "CONFLICT" });

    expect(next).toBe(before);
  });

  it("keeps the draft without remounting when the user keeps it", () => {
    const next = step(at("conflict", V1), { type: "KEEP_DRAFT", version: V2 });

    expect(stateOf(next)).toStrictEqual({
      editorKey: 0,
      status: "editing",
      version: V2,
    });
  });

  it("remounts the editor when the user reloads the latest", () => {
    // The remount is the transition: a fresh `key` is what makes the editor
    // re-read the server's body instead of keeping the mounted draft.
    const next = step(at("conflict", V1), {
      type: "RELOAD_LATEST",
      version: V2,
    });

    expect(stateOf(next)).toStrictEqual({
      editorKey: 1,
      status: "editing",
      version: V2,
    });
  });

  it("counts a second reload, so the editor remounts again", () => {
    const reloaded = step(at("conflict", V1), {
      type: "RELOAD_LATEST",
      version: V2,
    });
    const conflicted = step(reloaded, { type: "CONFLICT" });
    const again = step(conflicted, { type: "RELOAD_LATEST", version: V3 });

    expect(stateOf(again).editorKey).toBe(2);
    expect(stateOf(again).version).toBe(V3);
  });

  it("does not answer a conflict choice outside the conflict state", () => {
    // The panel is only rendered in `conflict`, so this is the graph agreeing
    // with the UI: neither choice can adopt a version while editing.
    const before = at("editing", V1);

    expect(step(before, { type: "KEEP_DRAFT", version: V2 })).toBe(before);
    expect(step(before, { type: "RELOAD_LATEST", version: V2 })).toBe(before);
  });
});
