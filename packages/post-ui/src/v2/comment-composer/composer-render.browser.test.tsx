import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useCommentComposer, useCommentComposerIsDisabled } from "./context";
import { CommentComposer } from "./index";
import { useCommentComposerState } from "./store";

// Render counters for faithful proxies of the composer's consumer components.
// Each proxy subscribes to exactly what the real component subscribes to
// (context + the store slices it selects), so any re-render the real
// component would perform is reflected here.
const renderCounts = vi.hoisted(() => ({ submit: 0, toggle: 0 }));

// The editor chain imports the auth client, which throws outside the app
// runtime; the rerender test never renders it, so stub it out.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/ui/editor", () => ({ Editor: () => null }));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/ui/editor/editor-store", () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./submit-button", () => ({
  SubmitButton: () => {
    renderCounts.submit += 1;
    // Same subscriptions as the real SubmitButton.
    useCommentComposer();
    useCommentComposerState((context) => context.isPrivate);
    useCommentComposerState((context) => context.statusUpdateId);
    useCommentComposerIsDisabled();
    return null;
  },
}));

// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./visibility-toggle", () => ({
  VisibilityToggle: () => {
    renderCounts.toggle += 1;
    // Same subscriptions as the real VisibilityToggle.
    useCommentComposer();
    useCommentComposerState((context) => context.isPrivate);
    useCommentComposerIsDisabled();
    return null;
  },
}));

function TypeProbe() {
  const { actions } = useCommentComposer();

  return (
    <button
      data-testid="type"
      onClick={() => actions.onContentChange("x")}
      type="button"
    />
  );
}

function VisibilityProbe() {
  const { actions } = useCommentComposer();

  return (
    <button
      data-testid="visibility"
      onClick={() => actions.onVisibilityChange(true)}
      type="button"
    />
  );
}

describe("CommentComposer rerender behavior", () => {
  it("does not re-render consumers while typing", async () => {
    const view = await render(
      <CommentComposer.Provider onSubmit={() => {}}>
        <TypeProbe />
        <VisibilityProbe />
        <CommentComposer.Submit />
      </CommentComposer.Provider>
    );

    // Settle initial mount, then baseline the counters.
    await new Promise((resolve) => setTimeout(resolve, 20));
    renderCounts.submit = 0;
    renderCounts.toggle = 0;

    // 10 "keystrokes" through the composer's real content pipeline.
    for (let i = 0; i < 10; i++) {
      await view.getByTestId("type").click();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(renderCounts.submit).toBe(0);
    expect(renderCounts.toggle).toBe(0);
  });

  it("re-renders consumers when a selected slice changes", async () => {
    const view = await render(
      <CommentComposer.Provider onSubmit={() => {}}>
        <TypeProbe />
        <VisibilityProbe />
        <CommentComposer.Submit />
      </CommentComposer.Provider>
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    renderCounts.submit = 0;
    renderCounts.toggle = 0;

    // Visibility feeds the submit label and the toggle state: both must
    // re-render exactly once per change.
    await view.getByTestId("visibility").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(renderCounts.submit).toBe(1);
    expect(renderCounts.toggle).toBe(1);
  });
});
