import { describe, expect, it } from "@effect/vitest";
import { NotificationId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { NotificationList, NotificationMarkRead } from "./schema";

describe("NotificationList", () => {
  it.effect("bounds the page size", () =>
    Effect.gen(function* () {
      const organizationId = yield* WorkspaceId.generate;
      const page = (limit: number) => ({ limit, organizationId });

      // The inbox is append-only and cursor-paged, so the limit is what keeps
      // one request a page rather than a full-table read. It reached `LIMIT`
      // unbounded before, which also made zero, negative, and fractional
      // values the driver's problem instead of a decode failure.
      expect(S.is(NotificationList)(page(1))).toBe(true);
      expect(S.is(NotificationList)(page(100))).toBe(true);
      expect(S.is(NotificationList)(page(0))).toBe(false);
      expect(S.is(NotificationList)(page(-1))).toBe(false);
      expect(S.is(NotificationList)(page(101))).toBe(false);
      expect(S.is(NotificationList)(page(2.5))).toBe(false);
      expect(S.is(NotificationList)({ organizationId })).toBe(true);
    })
  );
});

describe("NotificationMarkRead", () => {
  it.effect("requires the notification and its workspace", () =>
    Effect.gen(function* () {
      const organizationId = yield* WorkspaceId.generate;
      const notificationId = yield* NotificationId.generate;

      expect(
        S.is(NotificationMarkRead)({ notificationId, organizationId })
      ).toBe(true);
      // The workspace is what scopes the write, so a payload that names only
      // the notification must not decode: the handler would have no tenant to
      // authorize the mark-read against.
      expect(S.is(NotificationMarkRead)({ notificationId })).toBe(false);
    })
  );
});
