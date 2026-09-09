import { describe, expect, it, vi } from "vitest";

import { initPublicBoardI18n } from "../src/i18n";
import { m } from "../src/paraglide/messages.js";
import { getLocale, setLocale } from "../src/paraglide/runtime.js";

describe("initPublicBoardI18n", () => {
  it("resolves messages through the host-injected locale runtime", () => {
    initPublicBoardI18n({
      getLocale: () => "de",
      setLocale: () => undefined,
    });

    expect(getLocale()).toBe("de");
    expect(m.flaky_mad_walrus()).toBe("Abmelden");
  });

  it("delegates setLocale to the host runtime", async () => {
    const hostSetLocale = vi.fn();

    initPublicBoardI18n({
      getLocale: () => "en",
      setLocale: hostSetLocale,
    });

    await setLocale("de");

    expect(hostSetLocale).toHaveBeenCalledWith("de");
  });
});
