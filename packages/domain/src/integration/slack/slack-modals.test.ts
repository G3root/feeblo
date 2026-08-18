import { describe, expect, it } from "vitest";

import { buildSuccessModal } from "./slack-modals";

describe("buildSuccessModal", () => {
  it("renders post details and non-empty metadata in the Slack confirmation", () => {
    expect(
      buildSuccessModal({
        boardName: "Product ideas",
        metadata: {
          customer_tier: "Enterprise",
          empty_value: "   ",
          region: "Asia Pacific",
        },
        postId: "post_123",
        postTitle: "Support dark mode",
        postUrl: "https://feeblo.example/post/dark-mode",
        status: "IN_PROGRESS",
        submitterName: "Ada Lovelace",
      })
    ).toMatchObject({
      blocks: [
        { type: "section" },
        { type: "section" },
        {
          fields: [
            { text: "*Board:*\nProduct ideas", type: "mrkdwn" },
            { text: "*Status:*\nIn Progress", type: "mrkdwn" },
            { text: "*Source:*\nSlack", type: "mrkdwn" },
            { text: "*Submitted by:*\nAda Lovelace", type: "mrkdwn" },
            { text: "*Post ID:*\npost_123", type: "mrkdwn" },
            { text: "*Customer Tier:*\nEnterprise", type: "mrkdwn" },
            { text: "*Region:*\nAsia Pacific", type: "mrkdwn" },
          ],
          type: "section",
        },
        { type: "actions" },
      ],
    });
  });
});
