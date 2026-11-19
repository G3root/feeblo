import { describe, expect, it } from "vitest";

import {
  boardIconName,
  DEFAULT_BOARD_ICON,
  DEFAULT_HELP_CENTER_TOPIC_ICON,
  helpCenterTopicIconName,
  postStatusIconName,
} from "./defaults";

describe("entity icon defaults", () => {
  it("uses the board default when no icon is stored or the name is unknown", () => {
    expect(boardIconName(null)).toBe(DEFAULT_BOARD_ICON);
    expect(boardIconName("")).toBe(DEFAULT_BOARD_ICON);
    expect(boardIconName("not-a-tabler-icon")).toBe(DEFAULT_BOARD_ICON);
    expect(boardIconName(" bolt ")).toBe("bolt");
  });

  it("uses the status type's default when the row has no icon", () => {
    expect(postStatusIconName(null, "COMPLETED")).toBe("circle-check");
    expect(postStatusIconName("sparkles", "PENDING")).toBe("sparkles");
    expect(postStatusIconName("card", "PENDING")).toBe("clock");
  });

  it("uses the help-center default when no icon is stored", () => {
    expect(helpCenterTopicIconName(null)).toBe(DEFAULT_HELP_CENTER_TOPIC_ICON);
    expect(helpCenterTopicIconName("bug")).toBe("bug");
  });
});
