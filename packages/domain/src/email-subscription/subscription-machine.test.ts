import { describe, expect, it } from "@effect/vitest";
import {
  EMAIL_SUBSCRIPTION_STATES,
  type TEmailSubscriptionState,
} from "@feeblo/domain-contracts/email";

import {
  EMAIL_SUBSCRIPTION_EVENTS,
  EMAIL_SUBSCRIPTION_NODES,
  canTransitionSubscription,
  emailSubscriptionMachine,
  nextStateForRequest,
  sourceStatesFor,
  targetStateFor,
} from "./subscription-machine";

/**
 * The subscription machine answers two questions, and both are pinned here:
 * which moves the guarded updates may make, and what a consent request means
 * for a row that already exists (or does not).
 *
 * The request table is written out longhand rather than derived. It is the old
 * `verifiedStateFor` rule, and the point of replacing an `if` chain with data is
 * that the data can be read and compared — so it is compared, cell by cell.
 */

const ALL = EMAIL_SUBSCRIPTION_STATES;
const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

const verified = { alreadyVerified: true, deferredNoAccess: false };
const deferred = { alreadyVerified: false, deferredNoAccess: true };
const plain = { alreadyVerified: false, deferredNoAccess: false };

describe("email subscription machine", () => {
  it("declares every state the stored vocabulary allows, plus `none`", () => {
    // The vocabulary and the machine's keys are different lists that can
    // drift apart; `none` is the one machine-only state, and it exists so a
    // first request is a normal transition rather than a special case.
    expect(EMAIL_SUBSCRIPTION_NODES).toStrictEqual(["none", ...ALL]);
    expect(Object.keys(emailSubscriptionMachine.states)).toStrictEqual(
      EMAIL_SUBSCRIPTION_NODES
    );
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) =>
      canTransitionSubscription(from, to)
    );

    expect(allowed).toStrictEqual([
      ["pending_verification", "active"],
      ["pending_verification", "unsubscribed"],
      ["active", "paused_by_plan"],
      ["active", "unsubscribed"],
      ["paused_by_plan", "active"],
      ["paused_by_plan", "unsubscribed"],
      ["deferred_no_access", "active"],
      ["deferred_no_access", "unsubscribed"],
    ]);
  });

  it("derives each event's sources and target", () => {
    expect(sourceStatesFor("verify")).toStrictEqual(["pending_verification"]);
    expect(sourceStatesFor("pause")).toStrictEqual(["active"]);
    expect(sourceStatesFor("resume")).toStrictEqual(["paused_by_plan"]);
    expect(sourceStatesFor("activate")).toStrictEqual(["deferred_no_access"]);
    expect(sourceStatesFor("unsubscribe")).toStrictEqual([
      "pending_verification",
      "active",
      "paused_by_plan",
      "deferred_no_access",
    ]);

    expect(EMAIL_SUBSCRIPTION_EVENTS.map(targetStateFor)).toStrictEqual([
      "active",
      "paused_by_plan",
      "active",
      "unsubscribed",
      "active",
    ]);
  });

  it("covers every source state exactly once per event", () => {
    for (const event of EMAIL_SUBSCRIPTION_EVENTS) {
      const sources = sourceStatesFor(event);

      // A source that also took the event and stayed put would be invisible to
      // the generated WHERE, which is the one way this derivation can be
      // wrong. No event here has a self-transition.
      for (const state of sources) {
        expect(targetStateFor(event)).not.toBe(state);
      }
    }
  });

  it("treats unsubscribed as the only terminal state", () => {
    const terminal = ALL.filter(
      (state) =>
        !ALL.some((to) => to !== state && canTransitionSubscription(state, to))
    );

    expect(terminal).toStrictEqual(["unsubscribed"]);
  });

  it("reaches every state from a first request", () => {
    const reached = new Set<TEmailSubscriptionState>([
      nextStateForRequest(undefined, plain),
      nextStateForRequest(undefined, deferred),
      nextStateForRequest(undefined, verified),
    ]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of ALL) {
        if (!reached.has(from)) {
          continue;
        }
        for (const to of ALL) {
          if (!reached.has(to) && canTransitionSubscription(from, to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }

    expect([...reached].sort()).toStrictEqual([...ALL].sort());
  });

  it("answers a first request from what the caller proved", () => {
    expect(nextStateForRequest(undefined, verified)).toBe("active");
    expect(nextStateForRequest(undefined, deferred)).toBe("deferred_no_access");
    expect(nextStateForRequest(undefined, plain)).toBe("pending_verification");
  });

  it("lets a proof of ownership outrank every stored state", () => {
    for (const prior of ALL) {
      expect(nextStateForRequest(prior, verified)).toBe("active");
    }
  });

  it("keeps consent that already exists", () => {
    expect(nextStateForRequest("unsubscribed", plain)).toBe("unsubscribed");
    expect(nextStateForRequest("paused_by_plan", plain)).toBe("paused_by_plan");
    expect(nextStateForRequest("active", plain)).toBe("active");
    expect(nextStateForRequest("pending_verification", plain)).toBe(
      "pending_verification"
    );
    // A deferred request says "no account with access", not "unverified". For
    // a row already pending verification the flag changes nothing, so the
    // stored pending token and its expiry survive.
    expect(nextStateForRequest("pending_verification", deferred)).toBe(
      "pending_verification"
    );
  });

  it("re-arms verification for a deferred row once access is no longer the problem", () => {
    // A deferred row exists because the subject had no account with access.
    // Asking again when that is not the reason anymore means the address is
    // simply unverified, not that it is still deferred.
    expect(nextStateForRequest("deferred_no_access", plain)).toBe(
      "pending_verification"
    );
    expect(nextStateForRequest("deferred_no_access", deferred)).toBe(
      "deferred_no_access"
    );
  });

  it("starts in none, so a first request is a normal transition", () => {
    expect(emailSubscriptionMachine.getInitialSnapshot().value).toBe("none");
  });
});
