import { describe, expect, it } from "@effect/vitest";
import {
  DATA_IMPORT_STATUSES,
  type TDataImportStatus,
} from "@feeblo/domain-contracts/data-import";
import { transition } from "xstate";

import {
  DATA_IMPORT_JOB_STATES,
  dataImportJobMachine,
  canTransitionDataImportJob,
  isActiveDataImportStatus,
  isTerminalDataImportStatus,
  sourceStatesFor,
  targetStatesFor,
} from "./machine";

/**
 * The machine is the declaration of the import lifecycle, so these tests pin
 * the parts the SQL depends on: the graph the guards are generated from, and
 * agreement between the machine and the vocabulary every other layer reads.
 *
 * They are plain assertions rather than property tests: the graph is six states
 * by five events, and the point is that every one of those thirty cells was
 * considered once, here, instead of at three separate `WHERE` clauses.
 */

const ALL = DATA_IMPORT_STATUSES;

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe("data import job machine", () => {
  it("declares every status the stored vocabulary allows", () => {
    // `DATA_IMPORT_JOB_STATES` is an alias of the vocabulary, so comparing
    // the two proves nothing. The machine's own keys are the thing that can
    // drift, the same way `intent-machine.test.ts` reads it:
    expect(Object.keys(dataImportJobMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
    expect([...DATA_IMPORT_JOB_STATES].sort()).toStrictEqual([...ALL].sort());
  });

  it("starts in awaiting_confirmation", () => {
    expect(dataImportJobMachine.getInitialSnapshot().value).toBe(
      "awaiting_confirmation"
    );
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) =>
      canTransitionDataImportJob(from, to)
    );

    expect(allowed).toStrictEqual([
      ["awaiting_confirmation", "queued"],
      ["awaiting_confirmation", "canceled"],
      ["queued", "running"],
      ["queued", "canceled"],
      ["running", "completed"],
      ["running", "failed"],
      ["running", "canceled"],
    ]);
  });

  it("ends a running job as completed or failed, never the other way", () => {
    const running = dataImportJobMachine.resolveState({
      context: {},
      value: "running",
    });

    expect(
      transition(dataImportJobMachine, running, { type: "complete" })[0].value
    ).toBe("completed");
    expect(
      transition(dataImportJobMachine, running, { type: "fail" })[0].value
    ).toBe("failed");
    // A terminal job is never moved again by the worker.
    for (const ending of ["completed", "failed"] as const) {
      const snapshot = dataImportJobMachine.resolveState({
        context: {},
        value: ending,
      });
      expect(
        transition(dataImportJobMachine, snapshot, { type: "fail" })[0].value
      ).toBe(ending);
    }
  });

  it("keeps the happy path intact", () => {
    expect(targetStatesFor("awaiting_confirmation")).toStrictEqual([
      "queued",
      "canceled",
    ]);
    expect(targetStatesFor("queued")).toStrictEqual(["running", "canceled"]);
    expect(targetStatesFor("running")).toStrictEqual([
      "completed",
      "failed",
      "canceled",
    ]);
  });

  it("derives each state's predecessors from the same graph", () => {
    expect(sourceStatesFor("cancel")).toStrictEqual([
      "awaiting_confirmation",
      "queued",
      "running",
    ]);
    expect(sourceStatesFor("confirm")).toStrictEqual(["awaiting_confirmation"]);
    expect(sourceStatesFor("claim")).toStrictEqual(["queued"]);
    expect(sourceStatesFor("complete")).toStrictEqual(["running"]);
    expect(sourceStatesFor("fail")).toStrictEqual(["running"]);
  });

  it("treats the three outcomes as terminal and the other three as active", () => {
    const terminal = ALL.filter(isTerminalDataImportStatus);

    expect(terminal).toStrictEqual(["completed", "failed", "canceled"]);
    for (const status of ALL) {
      expect(isActiveDataImportStatus(status)).toBe(!terminal.includes(status));
    }
  });

  it("lets no terminal status move anywhere", () => {
    for (const from of ["completed", "failed", "canceled"] as const) {
      expect(targetStatesFor(from)).toStrictEqual([]);
    }
  });

  it("is reachable: every state has a path from the initial one", () => {
    const reached = new Set<TDataImportStatus>(["awaiting_confirmation"]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of DATA_IMPORT_JOB_STATES) {
        if (!reached.has(from)) {
          continue;
        }
        for (const to of targetStatesFor(from)) {
          if (!reached.has(to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }

    expect([...reached].sort()).toStrictEqual([...ALL].sort());
  });
});
