import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  fakePostMessage,
  installTestEmbedDependencies,
  MOCK_ORIGIN,
  triggerIframeLoad,
} from "../../test/react-browser-helpers";

beforeEach(() => {
  installTestEmbedDependencies();
});

import { Feeblo } from "../index";
import { getCurrentEmbed } from "../instance";
import { useFeeblo, useFeebloIsOpen, useFeebloIsReady } from "./hooks";
import { FeebloProvider } from "./provider";

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
      </FeebloProvider>
    );

    await expect
      .element(screen.getByTestId("org"))
      .toHaveTextContent("org_test");
    await expect.element(screen.getByText("hello")).toBeVisible();
  });

  it("starts with isReady=false and flips to true on widgetReady", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_ready">
        <Probe />
      </FeebloProvider>
    );

    await expect
      .element(screen.getByTestId("ready"))
      .toHaveTextContent("false");

    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );

    await expect.element(screen.getByTestId("ready")).toHaveTextContent("true");
    await expect
      .element(screen.getByTestId("ready2"))
      .toHaveTextContent("true");
  });

  it("tracks isOpen via widgetOpened / widgetClosed", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_open">
        <Probe />
      </FeebloProvider>
    );

    await expect.element(screen.getByTestId("open")).toHaveTextContent("false");

    window.dispatchEvent(
      new CustomEvent("widgetOpened", {
        detail: { data: undefined, type: "widgetOpened", namespace: "feeblo" },
      })
    );
    await expect.element(screen.getByTestId("open")).toHaveTextContent("true");

    window.dispatchEvent(
      new CustomEvent("widgetClosed", {
        detail: { data: undefined, type: "widgetClosed", namespace: "feeblo" },
      })
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
    await expect
      .element(screen.getByTestId("org"))
      .toHaveTextContent("org_user");

    // Mark the embed loaded so identify() reaches the iframe, then clear the
    // initial IDENTIFY for firstUser sent by the ready-handshake.
    triggerIframeLoad();
    fakePostMessage.mockClear();

    await screen.rerender(<Wrapper user={secondUser} />);
    await expect
      .element(screen.getByTestId("org"))
      .toHaveTextContent("org_user");

    await vi.waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalledWith(
        { event: "IDENTIFY", data: { id: "u_2", name: "Grace" } },
        MOCK_ORIGIN
      );
    });

    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);
  });

  it("destroys widget on unmount", async () => {
    const screen = await render(
      <FeebloProvider organizationId="org_destroy">
        <Probe />
      </FeebloProvider>
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
      </FeebloProvider>
    );

    expect(onReady).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("widgetReady", {
        detail: { data: undefined, type: "widgetReady", namespace: "feeblo" },
      })
    );

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });
});

describe("SDK logout identity clearing", () => {
  it("clears the retained token on logout re-init before recreating anonymously", async () => {
    Feeblo.init("org_clear", { user: { id: "u_1", token: "secret" } });
    triggerIframeLoad();
    fakePostMessage.mockClear();

    Feeblo.init("org_clear");

    // The widget must receive the explicit clear payload (IDENTIFY id:"") so
    // it drops any retained token before the anonymous reuse.
    await vi.waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalledWith(
        { event: "IDENTIFY", data: { id: "" } },
        MOCK_ORIGIN
      );
    });

    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);
  });
});

describe("FeebloProvider auth boundary", () => {
  it("reinitializes anonymously when a user token crosses an auth boundary (logout)", async () => {
    type TokenUser = { id: string; token: string };

    function Wrapper({ user }: { user: TokenUser | null }) {
      return (
        <FeebloProvider organizationId="org_logout" user={user}>
          <Probe />
        </FeebloProvider>
      );
    }

    const screen = await render(
      <Wrapper user={{ id: "u_1", token: "secret" }} />
    );
    await expect
      .element(screen.getByTestId("org"))
      .toHaveTextContent("org_logout");

    await screen.rerender(<Wrapper user={null} />);

    await vi.waitFor(() => {
      // The replaced singleton must be anonymous — no retained auto-login
      // token from the logged-out session.
      expect(getCurrentEmbed()).not.toBeNull();
      expect(getCurrentEmbed()?.getAutoLoginToken()).toBeUndefined();
    });
    expect(document.querySelectorAll("#feeblo-embed-container").length).toBe(1);
  });

  it("does not tear down an identified widget when the token stays present", async () => {
    type TokenUser = { id: string; token: string };

    function Wrapper({ user }: { user: TokenUser }) {
      return (
        <FeebloProvider organizationId="org_authed" user={user}>
          <Probe />
        </FeebloProvider>
      );
    }

    const first = { id: "u_1", token: "s" };
    const second = { id: "u_2", token: "s" };

    const screen = await render(<Wrapper user={first} />);
    triggerIframeLoad();
    fakePostMessage.mockClear();

    await screen.rerender(<Wrapper user={second} />);

    // Same auth boundary → identify without recreating the widget.
    await vi.waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalledWith(
        { event: "IDENTIFY", data: { id: "u_2", token: "s" } },
        MOCK_ORIGIN
      );
    });
    const containers = document.querySelectorAll("#feeblo-embed-container");
    expect(containers.length).toBe(1);
  });

  it("shares one widget across providers and destroys it only when the last unmounts", async () => {
    function Host({ showSecond }: { showSecond: boolean }) {
      return (
        <>
          <FeebloProvider organizationId="org_multi">
            <Probe />
          </FeebloProvider>
          {showSecond && (
            <FeebloProvider organizationId="org_multi">
              <Probe />
            </FeebloProvider>
          )}
        </>
      );
    }

    const screen = await render(<Host showSecond />);
    // Two providers mounting the same org/config share one singleton.
    expect(document.querySelectorAll("#feeblo-embed-container").length).toBe(1);

    // Unmounting the second provider keeps the singleton for the first.
    await screen.rerender(<Host showSecond={false} />);
    expect(document.querySelectorAll("#feeblo-embed-container").length).toBe(1);

    // Unmounting the last provider tears the singleton down.
    await screen.rerender(<div>none</div>);
    await vi.waitFor(() => {
      expect(document.getElementById("feeblo-embed-container")).toBeNull();
    });
  });
});
