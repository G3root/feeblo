import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import * as React from "react";

const { fakePostMessage, MOCK_ORIGIN } = vi.hoisted(() => {
  return {
    fakePostMessage: vi.fn(),
    MOCK_ORIGIN: "http://localhost:3001",
  };
});

vi.mock("../iframe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../iframe")>();
  return {
    ...actual,
    createIframe: () => {
      const iframe = document.createElement("iframe");
      iframe.src = "about:blank";
      Object.defineProperty(iframe, "contentWindow", {
        value: { postMessage: fakePostMessage },
        writable: true,
        configurable: true,
      });
      const originalAddEventListener = iframe.addEventListener.bind(iframe);
      let loadCb: EventListener | null = null;
      (iframe as unknown as { _feebloTriggerLoad?: () => void })._feebloTriggerLoad =
        () => {
          if (loadCb) loadCb(new Event("load") as unknown as Event);
        };
      iframe.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: unknown,
      ) => {
        if (type === "load") {
          loadCb =
            typeof listener === "function"
              ? (listener as EventListener)
              : (listener.handleEvent.bind(listener) as EventListener);
          return;
        }
        return (
          originalAddEventListener as unknown as (
            a: string,
            b: EventListenerOrEventListenerObject,
            c?: unknown,
          ) => void
        )(type, listener, options);
      }) as typeof iframe.addEventListener;
      return iframe;
    },
    iframeOrigin: () => MOCK_ORIGIN,
    resolveBaseUrl: () => MOCK_ORIGIN,
  };
});

vi.mock("../positioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../positioning")>();
  return {
    ...actual,
    createFloatingInstance: () => () => {},
  };
});

import { Feeblo } from "../index";
import { FeebloProvider } from "./provider";
import { FeebloTrigger, useFeebloTrigger } from "./trigger";

afterEach(() => {
  fakePostMessage.mockClear();
  Feeblo.destroy();
  document.getElementById("feeblo-embed-container")?.remove();
  document.getElementById("feeblo-widget-launcher")?.remove();
});

function triggerIframeLoad() {
  const iframe = document.querySelector("iframe") as unknown as {
    _feebloTriggerLoad?: () => void;
  } | null;
  iframe?._feebloTriggerLoad?.();
}

describe("FeebloTrigger", () => {
  it("renders a button with default text and opens widget on click", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_trigger">
        <FeebloTrigger />
      </FeebloProvider>,
    );

    const btn = screen.getByRole("button", { name: "Give feedback" });
    await expect.element(btn).toBeVisible();

    // Mark embed as loaded so postMessage for SHOW is sent
    triggerIframeLoad();
    // Dispatch widgetReady to update isReady internally (not required for SHOW but realistic)
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );

    await btn.click();

    await vi.waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String),
      );
    });
  });

  it("forwards custom children and board/metadata", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_trigger2">
        <FeebloTrigger board="bugs" metadata={{ source: "test" }}>
          Report a bug
        </FeebloTrigger>
      </FeebloProvider>,
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
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
        ]),
      );
      const ctxCall = calls.find((c) => (c as { event: string }).event === "SET_CONTEXT") as
        | { data: Record<string, string> }
        | undefined;
      expect(ctxCall?.data).toEqual(expect.objectContaining({ board: "bugs", source: "test" }));
    });
  });

  it("opens the correct module when module prop is set", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_mod" mode="hub" modules={["feedback", "updates"]}>
        <FeebloTrigger module="updates">What&apos;s new</FeebloTrigger>
      </FeebloProvider>,
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );
    fakePostMessage.mockClear();

    await screen.getByRole("button", { name: "What's new" }).click();

    await vi.waitFor(() => {
      const calls = fakePostMessage.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: "SET_MODULE", data: { module: "updates" } }),
        ]),
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
      </FeebloProvider>,
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );
    fakePostMessage.mockClear();

    const link = screen.getByRole("link", { name: "Feedback link" });
    await expect.element(link).toBeVisible();
    await link.click();

    expect(childClick).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String),
      ),
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
      </FeebloProvider>,
    );

    triggerIframeLoad();
    fakePostMessage.mockClear();
    await screen.getByRole("link", { name: "Blocked" }).click();

    await new Promise((r) => setTimeout(r, 50));
    const showCalls = fakePostMessage.mock.calls.filter(
      ([msg]) => (msg as { event: string }).event === "SHOW",
    );
    expect(showCalls.length).toBe(0);
  });
});

describe("useFeebloTrigger", () => {
  it("provides ref + onClick that open widget without a trigger component", async () => {
    function CustomButton() {
      const { ref, onClick } = useFeebloTrigger({ board: "roadmap" });
      return (
        <button type="button" ref={ref as React.Ref<HTMLButtonElement>} onClick={onClick}>
          Custom trigger
        </button>
      );
    }

    const screen = await render(
      <FeebloProvider organizationId="org_hook_trigger">
        <CustomButton />
      </FeebloProvider>,
    );

    triggerIframeLoad();
    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );
    fakePostMessage.mockClear();

    await screen.getByRole("button", { name: "Custom trigger" }).click();

    await vi.waitFor(() =>
      expect(fakePostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: "SHOW" }),
        expect.any(String),
      ),
    );
  });
});
