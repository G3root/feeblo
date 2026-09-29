import { describe, expect, it } from "vitest";

import { PublicApiV1Group } from "./api-contract";
import { PublicApiOperations } from "./operations";

/**
 * Contract guards for the operations registry.
 *
 * The registry is what a non-HTTP surface (an MCP server, a CLI) iterates, and
 * the HTTP group is what customers read. They must name the same set: an
 * endpoint without an operation would be a capability the other surfaces
 * silently lack, and an operation without an endpoint would be a tool that is
 * not documented anywhere. Neither is caught by the type checker, so it is
 * caught here.
 */
describe("public API operations registry", () => {
  it("names exactly the published endpoints", () => {
    const endpointNames = Object.keys(PublicApiV1Group.endpoints).sort();
    const operationNames = PublicApiOperations.map(
      (operation) => operation.name
    ).sort();

    expect(operationNames).toEqual(endpointNames);
  });

  it("describes every operation for a surface with no OpenAPI document", () => {
    for (const operation of PublicApiOperations) {
      expect(operation.description.length).toBeGreaterThan(0);
      expect(operation.name.length).toBeGreaterThan(0);
    }
  });

  it("never claims a destructive operation is read-only", () => {
    for (const operation of PublicApiOperations) {
      expect(
        operation.annotations.readOnly && operation.annotations.destructive
      ).toBe(false);
    }
  });
});
