import { describe, expect, it } from "vitest";

import { AllRpcs, RpcGroups } from "./rpc-group";
import { ProviderOwnedRpcNames, RpcHandlerRegistrations } from "./rpc-router";

/**
 * Contract guards for the RPC registry.
 *
 * `RpcGroups` is what `AllRpcs` merges and what the browser clients type
 * themselves against; `RpcHandlerRegistrations` is what the server route binds.
 * They are one registry split across two modules only because a handler layer
 * imports the database and `AllRpcs` ships to the browser, so the parity the
 * `satisfies` enforces at compile time is pinned here as behavior: a group with
 * no handler, a procedure listed twice, or a group merged twice fails this
 * suite instead of one request.
 */
describe("rpc registry", () => {
  it("pairs every group with a handler layer or a provider", () => {
    const registeredNames = new Set(Object.keys(RpcHandlerRegistrations));
    const groupNames = RpcGroups.map(([name]) => name);

    expect(groupNames.every((name) => registeredNames.has(name))).toBe(true);
    expect(registeredNames.size).toBe(groupNames.length);
  });

  it("names every group and procedure exactly once", () => {
    const groupNames = RpcGroups.map(([name]) => name);
    expect(new Set(groupNames).size).toBe(groupNames.length);

    const tags = [...AllRpcs.requests.keys()];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("merges exactly the registered groups into AllRpcs", () => {
    const registeredTags = new Set(
      RpcGroups.flatMap(([, group]) => [...group.requests.keys()])
    );

    expect(new Set(AllRpcs.requests.keys())).toEqual(registeredTags);
    expect(AllRpcs.requests.size).toBe(registeredTags.size);
  });

  it("marks only the provider-owned groups as composition-root supplied", () => {
    const markedProviderOwned = Object.entries(RpcHandlerRegistrations)
      .filter(([, handlers]) => handlers === "provider")
      .map(([name]) => name)
      .sort();

    expect([...ProviderOwnedRpcNames].sort()).toEqual(markedProviderOwned);
    expect(markedProviderOwned).toEqual([
      "DiscordManagement",
      "GitHubManagement",
      "SlackManagement",
      "WebhookManagement",
    ]);
  });
});
