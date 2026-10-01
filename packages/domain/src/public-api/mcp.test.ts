import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";

import { PublicApiMcpToolkit } from "./mcp";
import { PublicApiOperations } from "./operations";

/**
 * Contract guards for the MCP projection.
 *
 * The HTTP suite (`api-live.test.ts`) drives a real client through
 * `initialize`, `tools/list`, and `tools/call`; what these pin is the toolkit
 * itself. A tool holds the operation's own schemas — not a copy that can drift
 * — and its annotations are the ones a client shows in an approval prompt.
 */
describe("public api mcp projection", () => {
  it("names every tool after its operation, once", () => {
    const names = Object.keys(PublicApiMcpToolkit.tools);

    expect(names.sort()).toEqual(
      PublicApiOperations.map((operation) => operation.name).sort()
    );
    // A duplicate name would make `tools/call` ambiguous: the server resolves
    // by name, so the later registration would win silently.
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries the operation's own schemas onto the tool", () => {
    for (const operation of PublicApiOperations) {
      const tool = PublicApiMcpToolkit.tools[operation.name];

      // Identity, not equality: the tool validates and encodes with the schema
      // the operation itself declares, so there is no second copy to sync.
      expect(tool.parametersSchema).toBe(operation.input);
      expect(tool.successSchema).toBe(operation.output);
      expect(tool.failureSchema).toBe(operation.failure);
    }
  });

  it("carries the operation's description and annotations onto the tool", () => {
    for (const operation of PublicApiOperations) {
      const tool = PublicApiMcpToolkit.tools[operation.name];

      expect(Tool.getDescription(tool)).toBe(operation.description);
      expect(Context.getUnsafe(tool.annotations, Tool.Readonly)).toBe(
        operation.annotations.readOnly
      );
      expect(Context.getUnsafe(tool.annotations, Tool.Destructive)).toBe(
        operation.annotations.destructive
      );
      expect(Context.getUnsafe(tool.annotations, Tool.Idempotent)).toBe(
        operation.annotations.idempotent
      );
      expect(Context.getUnsafe(tool.annotations, Tool.OpenWorld)).toBe(
        operation.annotations.openWorld
      );
    }
  });
});
