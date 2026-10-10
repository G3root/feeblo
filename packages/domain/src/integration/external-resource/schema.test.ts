import { describe, expect, it } from "@effect/vitest";
import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  IntegrationConnectionId,
  PostExternalResourceLinkId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ExternalResourceRecord, PostExternalResourceLink } from "./schema";

const decodePostLink = Schema.decodeUnknownOption(PostExternalResourceLink);
const decodeRecord = Schema.decodeUnknownOption(ExternalResourceRecord);

/**
 * The URL schema is deliberately asymmetric: the write record constrains the
 * scheme, the read DTO does not.
 *
 * A stored non-http URL must still decode, because the dashboard renders it as
 * plain text rather than a link; rejecting it here would fail the whole
 * `listPostLinks` decode instead of showing that fallback.
 */
describe("external resource URL schemas", () => {
  it.effect(
    "reads a stored non-http URL so the dashboard can fall back to text",
    () =>
      Effect.gen(function* () {
        const link = {
          id: yield* PostExternalResourceLinkId.generate,
          connectionId: yield* IntegrationConnectionId.generate,
          provider: IntegrationProviderKey.make("github"),
          providerDisplayName: "GitHub",
          resourceType: IntegrationExternalResourceType.make("issue"),
          remoteUrl: "javascript:alert(1)",
          displayKey: "ISSUE-1",
          title: null,
          stateKey: null,
          safeMetadata: {},
        };

        expect(Option.isSome(decodePostLink(link))).toBe(true);
      })
  );

  it.effect("rejects a non-http URL on the write record", () =>
    Effect.gen(function* () {
      const record = {
        organizationId: yield* WorkspaceId.generate,
        connectionId: yield* IntegrationConnectionId.generate,
        resourceType: IntegrationExternalResourceType.make("issue"),
        remoteId: "ISSUE-1",
        remoteUrl: "javascript:alert(1)",
        displayKey: "ISSUE-1",
        title: null,
        stateKey: null,
        safeMetadata: {},
      };

      expect(Option.isNone(decodeRecord(record))).toBe(true);
    })
  );
});
