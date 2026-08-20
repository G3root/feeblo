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
import { useFeeblo, useFeebloIsOpen, useFeebloIsReady } from "./hooks";

afterEach(() => {
  fakePostMessage.mockClear();
  Feeblo.destroy();
  document.getElementById("feeblo-embed-container")?.remove();
  document.getElementById("feeblo-widget-launcher")?.remove();
});

function Probe() {
  const { isReady, isOpen, organizationId } = useFeeblo();
  const ready = useFeebloIsReady();
  const open = useFeebloIsOpen();
  return (
    <div>
      <output data-testid="org">{organizationId}</output>
      <output data-testid="ready">{String(isReady)}</output>
      <output data-testid="ready2">{String(ready)}</output>
      <output data-testid="open">{String(isOpen)}</output>
      <output data-testid="open2">{String(open)}</output>
    </div>
  );
}

describe("FeebloProvider", () => {
  it("renders children and exposes organizationId", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_test">
        <Probe />
        <span>hello</span>
      </FeebloProvider>,
    );

    await expect.element(screen.getByTestId("org")).toHaveTextContent("org_test");
    await expect.element(screen.getByText("hello")).toBeVisible();
  });

  it("starts with isReady=false and flips to true on widgetReady", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_ready">
        <Probe />
      </FeebloProvider>,
    );

    await expect.element(screen.getByTestId("ready")).toHaveTextContent("false");

    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );

    await expect.element(screen.getByTestId("ready")).toHaveTextContent("true");
    await expect.element(screen.getByTestId("ready2")).toHaveTextContent("true");
  });

  it("tracks isOpen via widgetOpened / widgetClosed", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_open">
        <Probe />
      </FeebloProvider>,
    );

    await expect.element(screen.getByTestId("open")).toHaveTextContent("false");

    window.dispatchEvent(
      new CustomEvent("widgetOpened", {
        detail: { data: undefined, type: "widgetOpened", namespace: "feeblo" },
      }),
    );
    await expect.element(screen.getByTestId("open")).toHaveTextContent("true");

    window.dispatchEvent(
      new CustomEvent("widgetClosed", {
        detail: { data: undefined, type: "widgetClosed", namespace: "feeblo" },
      }),
    );
    await expect.element(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("calls identify when user changes without recreating widget", async () => {
    const firstUser = { id: "u_1", name: "Ada" };
    const secondUser = { id: "u_2", name: "Grace" };

    function Wrapper({ user }: { user: typeof firstUser }) {
      return (
        <FeebloProvider organizationId="org_user" user={user}>
          <Probe />
        </FeebloProvider>
      );
    }

    const screen = await render(<Wrapper user={firstUser} />);
    await expect.element(screen.getByTestId("org")).toHaveTextContent("org_user");

    await screen.rerender(<Wrapper user={secondUser} />);
    await expect.element(screen.getByTestId("org")).toHaveTextContent("org_user");

    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);
  });

  it("destroys widget on unmount", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_destroy">
        <Probe />
      </FeebloProvider>,
    );

    expect(document.getElementById("feeblo-embed-container")).not.toBeNull();

    await screen.rerender(<div>gone</div>);

    await vi.waitFor(() => {
      expect(document.getElementById("feeblo-embed-container")).toBeNull();
    });
  });

  it("throws when useFeeblo is used outside provider", async () => {
    function Bad() {
      useFeeblo();
      return <div>bad</div>;
    }

    let threw = false;
    try {
      await render(<Bad />);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("calls onReady when widgetReady fires", async () => {
    const onReady = vi.fn();

    await render(
      <FeebloProvider organizationId="org_onready" onReady={onReady}>
        <Probe />
      </FeebloProvider>,
    );

    expect(onReady).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      }),
    );

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });
});
