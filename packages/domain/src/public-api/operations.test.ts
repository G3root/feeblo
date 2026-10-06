import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { PublicApiGroups } from "./api-contract";
import { PUBLIC_API_PAGE_MAX_LIMIT } from "./common";
import { PublicApiOperations } from "./operations";
import {
  ListBoardPostsInput,
  ListBoardsInput,
  ListChangelogInput,
  ListCompaniesInput,
  ListEndUsersInput,
  ListPostCommentsInput,
  ListPostActivityInput,
  ListPostVotesInput,
  ListPostsInput,
  ListTagsInput,
  ListVotesInput,
  PublicApiBoardPage,
  PublicApiChangelogPage,
  PublicApiCommentPage,
  PublicApiCompanyPage,
  PublicApiEndUserPage,
  PublicApiPostActivityPage,
  PublicApiPostPage,
  PublicApiTagPage,
  PublicApiVotePage,
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
      ListBoardsInput,
      ListPostsInput,
      ListPostActivityInput,
      ListPostCommentsInput,
      ListPostVotesInput,
      ListTagsInput,
      ListCompaniesInput,
      ListChangelogInput,
      ListEndUsersInput,
      ListVotesInput,
    ];
    const pageOutputs = [
      PublicApiBoardPage,
      PublicApiPostActivityPage,
      PublicApiPostPage,
      PublicApiCommentPage,
      PublicApiVotePage,
      PublicApiTagPage,
      PublicApiCompanyPage,
      PublicApiChangelogPage,
      PublicApiEndUserPage,
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

  it("refuses an empty tag filter on the typed input too", () => {
    // The HTTP projection rejects `?tagIds=`, but an MCP client sends typed
    // parameters, so the operation's own schema has to refuse the empty list:
    // otherwise the same call means "every post" on one surface and "no
    // filter" on the other, and a caller that joined an empty array gets a
    // page it did not ask for.
    expect(
      Option.isNone(Schema.decodeUnknownOption(ListPostsInput)({ tagIds: [] }))
    ).toBe(true);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(ListBoardPostsInput)({
          boardId: "brd_feedback",
          tagIds: [],
        })
      )
    ).toBe(true);

    // A list with one id is the shape the input does accept.
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(ListPostsInput)({ tagIds: ["tag_ui"] })
      )
    ).toBe(true);
  });

  it("names every URL parameter on the operation's input", () => {
    // The params schema is derived from the operation input, so a path
    // segment the input does not declare is the one thing the derivation
    // cannot catch: the URL would name a field no operation receives. The
    // endpoint path is the only place that name is written, so it is checked
    // against the input here.
    for (const group of PublicApiGroups) {
      for (const [identifier, endpoint] of Object.entries(group.endpoints)) {
        const operation = PublicApiOperations.find(
          (candidate) => candidate.name === identifier
        );
        if (operation === undefined) {
          return expect.fail(`no operation named ${identifier}`);
        }

        for (const match of endpoint.path.matchAll(/:([^/]+)/g)) {
          const name = match[1];
          if (name === undefined) {
            return expect.fail(`${endpoint.path} has an unnamed segment`);
          }
          if (!("fields" in operation.input)) {
            return expect.fail(
              `${identifier} has a path parameter but no typed input fields`
            );
          }
          expect(name in operation.input.fields).toBe(true);
        }
      }
    }
  });
});
