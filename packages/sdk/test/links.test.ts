import { afterEach, describe, expect, it } from "vitest";

import { authenticateLink, startLinkAuthentication } from "../src/links";

describe("data-feeblo-link", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("adds the SSO token in the URL fragment without dropping existing URL state", () => {
    const link = document.createElement("a");
    link.href = "https://feedback.example.com/roadmap?sort=top#planned";

    authenticateLink(link, "signed.jwt.token");

    const url = new URL(link.href);
    expect(url.searchParams.get("sort")).toBe("top");
    expect(url.search).not.toContain("ssoToken");
    expect(url.hash.startsWith("#planned&ssoToken=")).toBe(true);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    expect(hashParams.get("ssoToken")).toBe("signed.jwt.token");
  });

  it("replaces stale query and fragment SSO tokens", () => {
    const link = document.createElement("a");
    link.href =
      "https://feedback.example.com/roadmap?ssoToken=query-old&sort=top#planned&ssoToken=fragment-old&view=compact";

    authenticateLink(link, "current token");

    const url = new URL(link.href);
    expect(url.searchParams.has("ssoToken")).toBe(false);
    expect(url.searchParams.get("sort")).toBe("top");
    expect(url.hash).toBe("#planned&view=compact&ssoToken=current%20token");
  });

  it("authenticates dynamically-added marked links on interaction", () => {
    const link = document.createElement("a");
    link.href = "https://feedback.example.com/";
    link.setAttribute("data-feeblo-link", "");
    const child = document.createElement("span");
    link.appendChild(child);
    document.body.appendChild(link);

    const stop = startLinkAuthentication({
      getAutoLoginToken: () => "signed.jwt.token",
    });
    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    stop();

    const url = new URL(link.href);
    expect(new URLSearchParams(url.hash.slice(1)).get("ssoToken")).toBe(
      "signed.jwt.token"
    );
  });

  it("leaves the link unchanged when no identity token is available", () => {
    const link = document.createElement("a");
    link.href = "https://feedback.example.com/";
    link.setAttribute("data-feeblo-link", "");
    document.body.appendChild(link);
    const originalHref = link.href;

    const stop = startLinkAuthentication({
      getAutoLoginToken: () => undefined,
    });
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    stop();

    expect(link.href).toBe(originalHref);
  });
});
