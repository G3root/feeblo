import { describe, expect, it } from "vitest";

import { AllRpcs } from "./rpc-group";
import { isReadRpc, rpcKindOf } from "./rpc-kind";

/**
 * The runtime half of the verb-prefix convention `rpc-kind.ts` compiles over:
 * every tag in `AllRpcs` has a kind, the `Public` twin keeps its base's kind,
 * a verb only matches at a word boundary, and a tag this build does not know
 * has none.
 */
describe("rpc kind", () => {
  it("classifies every RPC in AllRpcs", () => {
    const unclassified = [...AllRpcs.requests.keys()].filter(
      (tag) => rpcKindOf(tag) === undefined
    );

    expect(unclassified).toEqual([]);
  });

  it("reads the kind from the verb prefix, public twin included", () => {
    expect(rpcKindOf("ListPosts")).toBe("read");
    expect(rpcKindOf("ListPostsPublic")).toBe("read");
    expect(rpcKindOf("ListPostDeleteEligibility")).toBe("read");
    expect(rpcKindOf("PreviewPostStatusDelete")).toBe("read");
    expect(rpcKindOf("ListSiteSubdomains")).toBe("read");
    expect(rpcKindOf("UpdatePostTitle")).toBe("write");
    expect(rpcKindOf("UpdatePostContentPublic")).toBe("write");
    expect(rpcKindOf("UpdateOrganizationMemberRole")).toBe("write");
    expect(rpcKindOf("SubscribeEmailSubscriptionPublic")).toBe("write");
  });

  it("matches a verb only at a word boundary", () => {
    // A tag that is exactly a verb carries that verb's kind; a longer word
    // that only starts with the letters of one does not.
    expect(rpcKindOf("List")).toBe("read");
    expect(rpcKindOf("Create")).toBe("write");
    // `Listen` starts with `List`, but not at a word boundary.
    expect(rpcKindOf("Listen")).toBeUndefined();
    expect(rpcKindOf("Getaway")).toBeUndefined();
  });

  it("answers no kind for a tag this build does not know", () => {
    expect(rpcKindOf("SomeFutureThing")).toBeUndefined();
    expect(isReadRpc("SomeFutureThing")).toBe(false);
  });
});
