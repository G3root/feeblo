import { afterEach, describe, expect, it } from "vitest";
import { authenticateLink, startLinkAuthentication } from "../src/links";

describe("data-feeblo-link", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("adds the SSO token without dropping existing URL state", () => {
    const link = document.createElement("a");
    link.href = "https://feedback.example.com/roadmap?sort=top#planned";

    authenticateLink(link, "signed.jwt.token");

    const url = new URL(link.href);
    expect(url.searchParams.get("sort")).toBe("top");
    expect(url.searchParams.get("ssoToken")).toBe("signed.jwt.token");
    expect(url.hash).toBe("#planned");
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

    expect(new URL(link.href).searchParams.get("ssoToken")).toBe(
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
