import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  fakePostMessage,
  installTestEmbedDependencies,
  triggerIframeLoad,
} from "../../test/react-browser-helpers";
import type { OutgoingMessage } from "../types";

let restoreEmbedDependencies: (() => void) | undefined;

beforeEach(() => {
  restoreEmbedDependencies = installTestEmbedDependencies();
});

import { Feeblo } from "../index";
import { FeebloProvider } from "./provider";
import { FeebloTrigger, useFeebloTrigger } from "./trigger";

afterEach(() => {
  restoreEmbedDependencies?.();
  fakePostMessage.mockClear();
  Feeblo.destroy();
  document.getElementById("feeblo-embed-container")?.remove();
  document.getElementById("feeblo-widget-launcher")?.remove();
});

describe("FeebloTrigger", () => {
  it("renders a button with default text and opens widget on click", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_trigger">
        <FeebloTrigger />
      </FeebloProvider>
    );

    const btn = screen.getByRole("button", { name: "Give feedback" });
    await expect.element(btn).toBeVisible();

    // Mark embed as loaded so postMessage for SHOW is sent
    triggerIframeLoad();
    // Dispatch widgetReady to update isReady internally (not required for SHOW but realistic)
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );

    await btn.click();

    await vi.waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String)
      );
    });
  });

  it("forwards custom children and board/metadata", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_trigger2">
        <FeebloTrigger board="bugs" metadata={{ source: "test" }}>
          Report a bug
        </FeebloTrigger>
      </FeebloProvider>
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );

    const btn = screen.getByRole("button", { name: "Report a bug" });
    await expect.element(btn).toBeVisible();
    fakePostMessage.mockClear();
    await btn.click();

    await vi.waitFor(() => {
      const calls = fakePostMessage.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: "SHOW" }),
          expect.objectContaining({ event: "SET_CONTEXT" }),
        ])
      );
      const ctxCall = calls.find(
        (
          message
        ): message is Extract<OutgoingMessage, { event: "SET_CONTEXT" }> =>
          message.event === "SET_CONTEXT"
      );
      expect(ctxCall?.data).toEqual(
        expect.objectContaining({ board: "bugs", source: "test" })
      );
    });
  });

  it("opens the correct module when module prop is set", async () => {
    const screen = await render(
      <FeebloProvider
        organizationId="org_mod"
        mode="hub"
        modules={["feedback", "updates"]}
      >
        <FeebloTrigger module="updates">What&apos;s new</FeebloTrigger>
      </FeebloProvider>
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );
    fakePostMessage.mockClear();

    await screen.getByRole("button", { name: "What's new" }).click();

    await vi.waitFor(() => {
      const calls = fakePostMessage.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "SET_MODULE",
            data: { module: "updates" },
          }),
        ])
      );
    });
  });

  it("supports asChild — clones child and preserves its onClick", async () => {
    const childClick = vi.fn();

    const screen = await render(
      <FeebloProvider organizationId="org_aschild">
        <FeebloTrigger asChild>
          <a href="#" onClick={childClick}>
            Feedback link
          </a>
        </FeebloTrigger>
      </FeebloProvider>
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );
    fakePostMessage.mockClear();

    const link = screen.getByRole("link", { name: "Feedback link" });
    await expect.element(link).toBeVisible();
    await link.click();

    expect(childClick).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String)
      )
    );
  });

  it("respects defaultPrevented — does not open if child's onClick prevents", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_prevent">
        <FeebloTrigger asChild>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Blocked
          </a>
        </FeebloTrigger>
      </FeebloProvider>
    );

    triggerIframeLoad();
    fakePostMessage.mockClear();
    await screen.getByRole("link", { name: "Blocked" }).click();

    await new Promise((r) => setTimeout(r, 50));
    const showCalls = fakePostMessage.mock.calls.filter(
      ([message]) => message.event === "SHOW"
    );
    expect(showCalls.length).toBe(0);
  });
});

describe("useFeebloTrigger", () => {
  it("provides ref + onClick that open widget without a trigger component", async () => {
    function CustomButton() {
      const { ref, onClick } = useFeebloTrigger({ board: "roadmap" });
      return (
        <button type="button" ref={ref} onClick={onClick}>
          Custom trigger
        </button>
      );
    }

    const screen = await render(
      <FeebloProvider organizationId="org_hook_trigger">
        <CustomButton />
      </FeebloProvider>
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );
    fakePostMessage.mockClear();

    await screen.getByRole("button", { name: "Custom trigger" }).click();

    await vi.waitFor(() =>
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String)
      )
    );
  });
});
