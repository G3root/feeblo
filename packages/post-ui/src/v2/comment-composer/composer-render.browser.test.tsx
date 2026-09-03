import { Profiler, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useCommentComposer } from "./context";
import { CommentComposerProvider } from "./provider";
import { SubmitButton } from "./submit-button";
import { VisibilityToggle } from "./visibility-toggle";

// Counts React commits of the real composer consumers: one event per mount
// or re-render of the profiled subtree, so the assertions below track the
// components' actual store usage instead of hand-written subscription
// proxies that could drift from it.
const renderCounts = vi.hoisted(() => ({ submit: 0, toggle: 0 }));

function RenderCounter({
  name,
  children,
}: {
  name: "submit" | "toggle";
  children: ReactNode;
}) {
  return (
    <Profiler
      id={name}
      onRender={() => {
        renderCounts[name] += 1;
      }}
    >
      {children}
    </Profiler>
  );
}

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

async function renderComposer() {
  return render(
    <CommentComposerProvider onSubmit={() => {}}>
      <TypeProbe />
      <VisibilityProbe />
      <RenderCounter name="submit">
        <SubmitButton />
      </RenderCounter>
      <RenderCounter name="toggle">
        <VisibilityToggle />
      </RenderCounter>
    </CommentComposerProvider>
  );
}

describe("CommentComposer rerender behavior", () => {
  it("does not re-render consumers while typing", async () => {
    const view = await renderComposer();

    // Settle the initial mount, then baseline the counters.
    await vi.waitFor(() => {
      expect(renderCounts.submit).toBeGreaterThan(0);
      expect(renderCounts.toggle).toBeGreaterThan(0);
    });
    renderCounts.submit = 0;
    renderCounts.toggle = 0;

    // 10 "keystrokes" through the composer's real content pipeline.
    for (let i = 0; i < 10; i++) {
      await view.getByTestId("type").click();
    }

    // Retry until both counts settle: they must stay at their baseline.
    await vi.waitFor(() => {
      expect(renderCounts.submit).toBe(0);
      expect(renderCounts.toggle).toBe(0);
    });
  });

  it("re-renders consumers when a selected slice changes", async () => {
    const view = await renderComposer();

    await vi.waitFor(() => {
      expect(renderCounts.submit).toBeGreaterThan(0);
      expect(renderCounts.toggle).toBeGreaterThan(0);
    });
    renderCounts.submit = 0;
    renderCounts.toggle = 0;

    // Visibility feeds the submit label and the toggle state: both must
    // re-render exactly once per change. This setup has no StrictMode
    // (vitest-browser-react mounts as-is), so there is no double render.
    await view.getByTestId("visibility").click();
    await vi.waitFor(() => {
      expect(renderCounts.submit).toBe(1);
      expect(renderCounts.toggle).toBe(1);
    });
  });
});
