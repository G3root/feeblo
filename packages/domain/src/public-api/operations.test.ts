import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { PublicApiGroups } from "./api-contract";
import { PUBLIC_API_PAGE_MAX_LIMIT } from "./common";
import { PublicApiOperations } from "./operations";
import {
  ListBoardPostsInput,
  ListChangelogInput,
  ListCompaniesInput,
  ListPostCommentsInput,
  ListPostsInput,
  ListTagsInput,
  PublicApiChangelogPage,
  PublicApiCommentPage,
  PublicApiCompanyPage,
  PublicApiPostPage,
  PublicApiTagPage,
} from "./schema";

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
    const endpointNames = PublicApiGroups.flatMap((group) =>
      Object.keys(group.endpoints)
    ).sort();
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

  it("pages every list with a cursor and a bounded page size", () => {
    const listInputs = [
      ListBoardPostsInput,
      ListPostsInput,
      ListPostCommentsInput,
      ListTagsInput,
      ListCompaniesInput,
      ListChangelogInput,
    ];
    const pageOutputs = [
      PublicApiPostPage,
      PublicApiCommentPage,
      PublicApiTagPage,
      PublicApiCompanyPage,
      PublicApiChangelogPage,
    ];

    for (const input of listInputs) {
      // Cursor-based: the caller passes the opaque cursor from the previous
      // page back, rather than an offset that a concurrent insert can shift.
      expect("cursor" in input.fields).toBe(true);

      // The HTTP projection clamps `limit` before it calls the operation, but
      // an MCP tool or a CLI decodes this schema directly, so the bound has to
      // live here too or a direct caller can ask for an unbounded page.
      const limit = input.fields.limit;
      expect(
        Option.isSome(
          Schema.decodeUnknownOption(limit)(PUBLIC_API_PAGE_MAX_LIMIT)
        )
      ).toBe(true);
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(limit)(PUBLIC_API_PAGE_MAX_LIMIT + 1)
        )
      ).toBe(true);
    }

    for (const page of pageOutputs) {
      expect("nextCursor" in page.fields).toBe(true);
    }
  });
});
