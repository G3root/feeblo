import { describe, expect, it } from "vitest";

import { initPostUiI18n } from "./i18n";
import { formatPostStatus } from "./post-status";

describe("formatPostStatus", () => {
  it("localizes the canonical status vocabulary through the host runtime", () => {
    initPostUiI18n({ getLocale: () => "de", setLocale: () => undefined });

    expect(formatPostStatus("IN_PROGRESS")).toBe("In Bearbeitung");
  });

  it("title-cases a workspace-defined status type", () => {
    expect(formatPostStatus("waiting_on_customer")).toBe("Waiting On Customer");
  });
});
