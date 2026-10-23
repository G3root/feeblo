import { expect, it } from "@effect/vitest";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { UpvoteList } from "./schema";

it.effect("rejects an empty slug while allowing an absent or real one", () =>
  Effect.gen(function* () {
    const organizationId = yield* WorkspaceId.generate;

    // An empty slug must not be a third state: the repository filters treat it
    // as absent, so accepting it here would let the wire value and the
    // projection disagree about whether the read is scoped.
    expect(S.is(UpvoteList)({ organizationId, slug: "" })).toBe(false);
    expect(S.is(UpvoteList)({ organizationId })).toBe(true);
    expect(S.is(UpvoteList)({ organizationId, slug: "feature-x" })).toBe(true);
  })
);
