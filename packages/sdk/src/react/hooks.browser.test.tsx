import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

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
import { useFeebloEvent, useOnFeedbackSubmitted } from "./hooks";

afterEach(() => {
  fakePostMessage.mockClear();
  Feeblo.destroy();
  document.getElementById("feeblo-embed-container")?.remove();
  document.getElementById("feeblo-widget-launcher")?.remove();
});

function fireFeedback(title: string) {
  window.dispatchEvent(
    new CustomEvent("feedbackSubmitted", {
      detail: {
        data: { boardId: "b1", boardName: "Roadmap", title },
        type: "feedbackSubmitted",
        namespace: "feeblo",
      },
    }),
  );
}

describe("useFeebloEvent", () => {
  it("receives feedbackSubmitted events", async () => {
    const handler = vi.fn();

    function Listener() {
      useFeebloEvent("feedbackSubmitted", handler);
      return <div>listener</div>;
    }

    await render(
      <FeebloProvider organizationId="org_hooks">
        <Listener />
      </FeebloProvider>,
    );

    fireFeedback("hello world");

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(handler.mock.calls[0]?.[0].detail.data?.title).toBe("hello world");
  });

  it("keeps stable subscription when handler identity changes (ref pattern)", async () => {
    const first = vi.fn();
    const second = vi.fn();

    function Switchable({ useSecond }: { useSecond: boolean }) {
      const handler = useSecond ? second : first;
      useFeebloEvent("widgetOpened", handler as unknown as typeof first);
      return <div>switchable</div>;
    }

    const screen = await render(
      <FeebloProvider organizationId="org_switch">
        <Switchable useSecond={false} />
      </FeebloProvider>,
    );

    window.dispatchEvent(
      new CustomEvent("widgetOpened", {
        detail: { data: { module: "feedback" }, type: "widgetOpened", namespace: "feeblo" },
      }),
    );
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
    expect(second).not.toHaveBeenCalled();

    first.mockClear();

    await screen.rerender(
      <FeebloProvider organizationId="org_switch">
        <Switchable useSecond={true} />
      </FeebloProvider>,
    );

    window.dispatchEvent(
      new CustomEvent("widgetOpened", {
        detail: { data: { module: "feedback" }, type: "widgetOpened", namespace: "feeblo" },
      }),
    );
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
  });

  it("cleans up on unmount — no more calls after unmount", async () => {
    const handler = vi.fn();

    function Listener() {
      useFeebloEvent("widgetClosed", handler);
      return <div>listener</div>;
    }

    const screen = await render(
      <FeebloProvider organizationId="org_cleanup">
        <Listener />
      </FeebloProvider>,
    );

    await screen.rerender(
      <FeebloProvider organizationId="org_cleanup">
        <div>empty</div>
      </FeebloProvider>,
    );

    window.dispatchEvent(
      new CustomEvent("widgetClosed", {
        detail: { data: undefined, type: "widgetClosed", namespace: "feeblo" },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports wildcard '*' subscription", async () => {
    const handler = vi.fn();

    function Wild() {
      useFeebloEvent("*" as const, handler as unknown as Parameters<typeof useFeebloEvent>[1]);
      return <div>wild</div>;
    }

    await render(
      <FeebloProvider organizationId="org_wild">
        <Wild />
      </FeebloProvider>,
    );

    // Clear any automatic calls (none with our mock, but be safe)
    handler.mockClear();

    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("widgetClosed", {
        detail: { data: undefined, type: "widgetClosed", namespace: "feeblo" },
      }),
    );

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });
});

describe("useOnFeedbackSubmitted", () => {
  it("is a convenience wrapper for feedbackSubmitted", async () => {
    const handler = vi.fn();

    function Listener() {
      useOnFeedbackSubmitted(handler);
      return <div>listener</div>;
    }

    await render(
      <FeebloProvider organizationId="org_conv">
        <Listener />
      </FeebloProvider>,
    );

    fireFeedback("convenience");

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(handler.mock.calls[0]?.[0].detail.data?.title).toBe("convenience");
  });
});
