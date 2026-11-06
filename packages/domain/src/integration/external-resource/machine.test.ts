import { describe, expect, it } from "@effect/vitest";
import {
  EXTERNAL_RESOURCE_CREATE_REQUEST_STATES,
  type TExternalResourceCreateRequestState,
} from "@feeblo/domain-contracts/integration";

import {
  EXTERNAL_RESOURCE_CREATE_REQUEST_EVENTS,
  RESERVED_CREATE_REQUEST_STATE,
  canTransitionCreateRequest,
  externalResourceCreateRequestMachine,
  sourceStatesFor,
  targetStateFor,
} from "./machine";

/**
 * The machine is the declaration of the reservation lifecycle, so these tests
 * pin the graph the guarded updates are generated from: which states may record
 * an ending, which may be re-claimed, and which are terminal.
 *
 * Three states by three events is nine cells; the point is that every one of
 * them was considered once, here, instead of across three inline comparisons in
 * `live.ts`.
 */

const ALL = EXTERNAL_RESOURCE_CREATE_REQUEST_STATES;

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe("external resource create request machine", () => {
  it("declares exactly the stored states", () => {
    expect(
      Object.keys(externalResourceCreateRequestMachine.states).sort()
    ).toStrictEqual([...ALL].sort());
  });

  it("starts pending", () => {
    expect(
      externalResourceCreateRequestMachine.getInitialSnapshot().value
    ).toBe("pending");
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) =>
      canTransitionCreateRequest(from, to)
    );

    expect(allowed).toStrictEqual([
      ["pending", "succeeded"],
      ["pending", "failed"],
      ["failed", "pending"],
    ]);
  });

  it("ends a reservation only from pending", () => {
    expect(sourceStatesFor("fail")).toStrictEqual(["pending"]);
    expect(sourceStatesFor("succeed")).toStrictEqual(["pending"]);
    expect(targetStateFor("fail")).toBe("failed");
    expect(targetStateFor("succeed")).toBe("succeeded");
  });

  it("re-claims only a failed reservation", () => {
    expect(sourceStatesFor("reclaim")).toStrictEqual(["failed"]);
    expect(targetStateFor("reclaim")).toBe("pending");
    // A fresh reservation and a re-claim land in the same state, so the insert
    // reads the initial state from the machine rather than naming it.
    expect(RESERVED_CREATE_REQUEST_STATE).toBe(targetStateFor("reclaim"));
    // The stale-lease re-claim is not here: a `pending` row that outlived its
    // reservation stays `pending`, so it is a SQL predicate on an unchanged
    // state rather than an edge. A self-transition would make "handled" and
    // "rejected" indistinguishable — which is why the reservation's single
    // `UPDATE` composes this source set with a `createdAt < lease` predicate.
    expect(sourceStatesFor("reclaim")).toStrictEqual(["failed"]);
  });

  it("reserves only a pending row for the provider call", () => {
    // The one guarded `UPDATE` that ends a creation asks both events, which is
    // what makes `pending` the only state the provider call may run from.
    expect(sourceStatesFor("succeed")).toStrictEqual(["pending"]);
    expect(sourceStatesFor("fail")).toStrictEqual(["pending"]);
  });

  it("lets nothing leave succeeded", () => {
    // A failed reservation is not terminal: a retry of the same idempotency key
    // re-claims it. A succeeded one is — the resource exists and the link is
    // recorded, so no event moves the row again.
    expect(
      ALL.filter((to) => canTransitionCreateRequest("succeeded", to))
    ).toStrictEqual([]);
    expect(
      ALL.filter((to) => canTransitionCreateRequest("failed", to))
    ).toStrictEqual(["pending"]);
  });

  it("is reachable: every state has a path from pending", () => {
    const reached = new Set<TExternalResourceCreateRequestState>(["pending"]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of ALL) {
        if (!reached.has(from)) {
          continue;
        }
        for (const to of ALL) {
          if (canTransitionCreateRequest(from, to) && !reached.has(to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }

    expect([...reached].sort()).toStrictEqual([...ALL].sort());
  });

  it("names every event it models", () => {
    // A new state or edge without a named event is a graph the callers cannot
    // ask about, so the event list is part of the declaration.
    expect([...EXTERNAL_RESOURCE_CREATE_REQUEST_EVENTS]).toStrictEqual([
      "fail",
      "reclaim",
      "succeed",
    ]);
  });
});
