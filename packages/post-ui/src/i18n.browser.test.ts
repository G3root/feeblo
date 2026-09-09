import { describe, expect, it, vi } from "vitest";

import { initPostUiI18n } from "./i18n";
import { m } from "./paraglide/messages.js";
import { getLocale, setLocale } from "./paraglide/runtime.js";

describe("initPostUiI18n", () => {
  it("resolves messages through the host-injected locale runtime", () => {
    initPostUiI18n({
      getLocale: () => "de",
      setLocale: () => undefined,
    });

    expect(getLocale()).toBe("de");
    expect(m.salty_few_seal()).toBe("Anmelden");
  });

  it("delegates setLocale to the host runtime", async () => {
    const hostSetLocale = vi.fn();

    initPostUiI18n({
      getLocale: () => "en",
      setLocale: hostSetLocale,
    });

    await setLocale("de");

    expect(hostSetLocale).toHaveBeenCalledWith("de");
  });
});
