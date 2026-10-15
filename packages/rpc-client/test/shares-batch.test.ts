import { describe, expect, it } from "vitest";

import { sharesRpcBatch } from "../src/index";

/**
 * The wiring decision the batch protocol cannot make for itself: which tags
 * may share one HTTP request. Both halves of the `index.ts` policy matter
 * here — reads share, and a stream does not, because a batch that carried it
 * could never be cancelled when its caller goes away.
 */
describe("sharesRpcBatch", () => {
  it("lets unary reads share a batch", () => {
    expect(sharesRpcBatch("PostList")).toBe(true);
    expect(sharesRpcBatch("PostGetPublic")).toBe(true);
    expect(sharesRpcBatch("NotificationUnreadCount")).toBe(true);
    expect(sharesRpcBatch("PostDeleteEligibilityList")).toBe(true);
  });

  it("sends writes alone", () => {
    expect(sharesRpcBatch("PostUpdate")).toBe(false);
    expect(sharesRpcBatch("OrganizationUpdateMemberRole")).toBe(false);
  });

  it("sends streaming reads alone", () => {
    expect(sharesRpcBatch("DataImportListWatch")).toBe(false);
    expect(sharesRpcBatch("DataImportWatch")).toBe(false);
  });

  it("sends a tag this build does not know alone", () => {
    expect(sharesRpcBatch("SomeFutureThing")).toBe(false);
  });
});
