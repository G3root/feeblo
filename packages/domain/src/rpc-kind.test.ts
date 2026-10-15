import { describe, expect, it } from "vitest";

import { AllRpcs } from "./rpc-group";
import { isReadRpc, rpcKindOf } from "./rpc-kind";

/**
 * The runtime half of the name convention `rpc-kind.ts` compiles over: every
 * tag in `AllRpcs` has a kind, the `Public` twin reads as its base, and a tag
 * this build does not know has none.
 */
describe("rpc kind", () => {
  it("classifies every RPC in AllRpcs", () => {
    const unclassified = [...AllRpcs.requests.keys()].filter(
      (tag) => rpcKindOf(tag) === undefined
    );

    expect(unclassified).toEqual([]);
  });

  it("reads the kind from the name, public twin included", () => {
    expect(rpcKindOf("PostList")).toBe("read");
    expect(rpcKindOf("PostGetPublic")).toBe("read");
    expect(rpcKindOf("PostDeleteEligibilityList")).toBe("read");
    expect(rpcKindOf("PostStatusDeletePreview")).toBe("read");
    expect(rpcKindOf("SiteSubdomainList")).toBe("read");
    expect(rpcKindOf("PostUpdateTitle")).toBe("write");
    expect(rpcKindOf("PostUpdateContentPublic")).toBe("write");
    expect(rpcKindOf("OrganizationUpdateMemberRole")).toBe("write");
  });

  it("answers no kind for a tag this build does not know", () => {
    expect(rpcKindOf("SomeFutureThing")).toBeUndefined();
    expect(isReadRpc("SomeFutureThing")).toBe(false);
  });
});
