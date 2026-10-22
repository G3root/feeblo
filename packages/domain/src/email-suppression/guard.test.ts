import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { sendUnlessSuppressed } from "./guard";
import { EmailSuppressionRepository } from "./repository";

describe("sendUnlessSuppressed", () => {
  const TestLayer = EmailSuppressionRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Guard workspace",
      slug: organizationId,
      createdAt: now,
    });
    return organizationId;
  });

  layer(TestLayer)("guard", (it) => {
    it.effect("does not run the send for a platform hard bounce", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const sent = yield* Ref.make(0);
        const now = yield* DateTime.nowAsDate;
        yield* repository.upsert({
          email: "bounced@example.com",
          now,
          organizationId: null,
          providerEventId: null,
          reason: "hard_bounce",
        });

        yield* sendUnlessSuppressed({
          email: "Bounced@Example.com",
          organizationId: null,
          send: Ref.update(sent, (count) => count + 1),
        });

        expect(yield* Ref.get(sent)).toBe(0);
      })
    );

    it.effect("lets a workspace complaint through for account mail", () =>
      Effect.gen(function* () {
        const repository = yield* EmailSuppressionRepository;
        const sent = yield* Ref.make(0);
        const organizationId = yield* createOrganization();
        const now = yield* DateTime.nowAsDate;
        yield* repository.upsert({
          email: "complained@example.com",
          now,
          organizationId,
          providerEventId: null,
          reason: "complaint",
        });

        // A password reset is not the workspace whose mail was complained
        // about, so the workspace row must not stop it.
        yield* sendUnlessSuppressed({
          email: "complained@example.com",
          organizationId: null,
          send: Ref.update(sent, (count) => count + 1),
        });

        expect(yield* Ref.get(sent)).toBe(1);
      })
    );

    it.effect("runs the send when the address is clear", () =>
      Effect.gen(function* () {
        const sent = yield* Ref.make(0);

        yield* sendUnlessSuppressed({
          email: "clear@example.com",
          organizationId: null,
          send: Ref.update(sent, (count) => count + 1),
        });

        expect(yield* Ref.get(sent)).toBe(1);
      })
    );
  });
});
