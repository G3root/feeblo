import { expect, it } from "@effect/vitest";
import { McpSchema } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { Approval, ApprovalDenied } from "./approval";

/**
 * The `ask` gate, against a scripted MCP client.
 *
 * The live suites (`mcp-live.test.ts`) cover a deployment whose gate is
 * `allow` or `deny`. `ask` needs a client that answers a server-initiated
 * elicitation, which the in-memory MCP test client deliberately refuses to do;
 * so this suite supplies the two request-scoped services the transport would
 * provide — the connection's capabilities and its reverse client — and drives
 * every answer a person can give: approve, reject the form, decline, dismiss,
 * and a client that cannot be asked at all.
 *
 * What is not covered here is the transport delivering the request, which is
 * Effect's `McpServer.layerHttp`; this suite pins the decisions Feeblo makes on
 * top of it — the capability check, the form, and the mapping from an answer to
 * a typed refusal.
 */

const CLIENT_INFO = { name: "test-client", version: "1.0.0" } as const;

const PROTOCOL_VERSION = "2025-11-25" as const;

const CAPABILITIES = { elicitation: { form: {} } } as const;

/** The answers a client can give to the approval form. */
type Answer =
  | { readonly action: "accept"; readonly approved: boolean }
  | { readonly action: "cancel" }
  | { readonly action: "decline" };

const elicitResult = (answer: Answer): McpSchema.ElicitResult => {
  switch (answer.action) {
    case "accept":
      return { action: "accept", content: { approved: answer.approved } };
    case "cancel":
    case "decline":
      return { action: answer.action };
  }
};

/** The capabilities the connection advertises, or none. */
const capabilities = (supportsElicitation: boolean) =>
  new McpSchema.ClientCapabilities(supportsElicitation ? CAPABILITIES : {});

const approvalRequest = {
  input: { postId: "post_1" },
  operation: "deletePost",
} as const;

/**
 * The two services the transport provides to a request-scoped handler.
 *
 * A `supportsElicitation: false` client still gets a reverse client — a real
 * one can be asked, it just did not advertise the capability — so a test that
 * passes proves the gate checks the capability instead of calling the client
 * and letting it fail.
 */
const clientLayer = (options: {
  readonly answer: Answer;
  readonly seen: Ref.Ref<Option.Option<McpSchema.ElicitRequestParams>>;
  readonly supportsElicitation: boolean;
}) => {
  const clientCapabilities = capabilities(options.supportsElicitation);

  return Layer.mergeAll(
    Layer.succeed(
      McpSchema.McpRequestContext,
      McpSchema.McpRequestContext.of({
        clientCapabilities,
        clientId: 1,
        protocolVersion: PROTOCOL_VERSION,
      })
    ),
    Layer.succeed(
      McpSchema.McpServerClient,
      McpSchema.McpServerClient.of({
        clientCapabilities,
        clientId: 1,
        clientInfo: CLIENT_INFO,
        getClient: Effect.succeed({
          createMessage: () => Effect.die("unexpected sampling request"),
          elicit: (request) =>
            Ref.set(options.seen, Option.some(request)).pipe(
              Effect.as(elicitResult(options.answer))
            ),
          listRoots: () => Effect.die("unexpected roots request"),
        }),
        initializePayload: {
          capabilities: options.supportsElicitation ? CAPABILITIES : {},
          clientInfo: CLIENT_INFO,
          protocolVersion: PROTOCOL_VERSION,
        },
        protocolVersion: PROTOCOL_VERSION,
      })
    )
  );
};

/** One approval through `ask`, with the connection a test scripted. */
const approve = (options: {
  readonly answer: Answer;
  readonly input?: Schema.Json | undefined;
  readonly seen: Ref.Ref<Option.Option<McpSchema.ElicitRequestParams>>;
  readonly supportsElicitation: boolean;
}) =>
  Effect.gen(function* () {
    const approval = yield* Approval;
    return yield* approval.approve({
      input: options.input ?? approvalRequest.input,
      operation: approvalRequest.operation,
    });
  }).pipe(
    // The connection a case scripts is request-scoped data, not a shared
    // layer, so it cannot be hoisted into an `it.layer`; this helper is the
    // entry point for the code under test.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- See the comment above: the scripted connection is per-case data, so there is no composition root to hoist the layer into.
    Effect.provide(Layer.mergeAll(Approval.ask, clientLayer(options)))
  );

/** The approval the gate put to the client, when it put one. */
const shownRequest = (
  request: Option.Option<McpSchema.ElicitRequestParams>
) => {
  if (Option.isNone(request)) {
    throw new Error("the gate did not ask the client");
  }
  return request.value;
};

it.effect("asks the client and runs the call when the person approves", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    yield* approve({
      answer: { action: "accept", approved: true },
      seen,
      supportsElicitation: true,
    });

    const shown = shownRequest(yield* Ref.get(seen));
    expect(shown.mode).toBe("form");
    expect(shown.message).toContain("deletePost");
    if (shown.mode !== "form") return;
    // The form asks for exactly one boolean, so a client renders a yes/no.
    expect(JSON.stringify(shown.requestedSchema)).toContain("approved");
  })
);

it.effect("names the record the call would change", () =>
  Effect.gen(function* () {
    const first = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );
    const second = yield* Ref.make<
      Option.Option<McpSchema.ElicitRequestParams>
    >(Option.none());

    // The answer is irrelevant here; the request is what is being read.
    for (const [seen, postId] of [
      [first, "post_1"],
      [second, "post_2"],
    ] as const) {
      yield* approve({
        answer: { action: "decline" },
        input: { postId },
        seen,
        supportsElicitation: true,
      }).pipe(Effect.ignore);
    }

    const firstMessage = shownRequest(yield* Ref.get(first)).message;
    const secondMessage = shownRequest(yield* Ref.get(second)).message;

    expect(firstMessage).toContain("post_1");
    expect(secondMessage).toContain("post_2");
    // Same operation, different target: the person must be able to tell the
    // two calls apart before approving either.
    expect(firstMessage).not.toBe(secondMessage);
  })
);

it.effect("bounds the input it shows", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    yield* approve({
      answer: { action: "decline" },
      input: { content: "x".repeat(5_000) },
      seen,
      supportsElicitation: true,
    }).pipe(Effect.ignore);

    const message = shownRequest(yield* Ref.get(seen)).message;

    // A dialog that scrolls is a dialog people approve without reading: the
    // long field is cut, but the field is still visible.
    expect(message.length).toBeLessThan(400);
    expect(message).toContain('"content"');
    expect(message).toContain("...");
  })
);

it.effect("refuses the call when the person rejects the form", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    const failure = yield* approve({
      answer: { action: "accept", approved: false },
      seen,
      supportsElicitation: true,
    }).pipe(Effect.flip);

    expect(Schema.is(ApprovalDenied)(failure)).toBe(true);
    if (Schema.is(ApprovalDenied)(failure)) {
      expect(failure.operation).toBe("deletePost");
      expect(failure.message).toContain("was not approved");
    }
    expect(Option.isSome(yield* Ref.get(seen))).toBe(true);
  })
);

it.effect("refuses the call when the person declines it", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    const failure = yield* approve({
      answer: { action: "decline" },
      seen,
      supportsElicitation: true,
    }).pipe(Effect.flip);

    expect(Schema.is(ApprovalDenied)(failure)).toBe(true);
    if (Schema.is(ApprovalDenied)(failure)) {
      expect(failure.message).toContain("was declined");
    }
  })
);

it.effect("refuses without asking a client that cannot be asked", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    const failure = yield* approve({
      answer: { action: "accept", approved: true },
      seen,
      supportsElicitation: false,
    }).pipe(Effect.flip);

    expect(Schema.is(ApprovalDenied)(failure)).toBe(true);
    if (Schema.is(ApprovalDenied)(failure)) {
      expect(failure.message).toContain("cannot be asked");
    }
    // The client has a reverse client that would have answered yes; the gate
    // refused anyway, which is what proves it checks the capability.
    expect(Option.isNone(yield* Ref.get(seen))).toBe(true);
  })
);

it.effect("interrupts the call when the person dismisses the form", () =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<Option.Option<McpSchema.ElicitRequestParams>>(
      Option.none()
    );

    const exit = yield* Effect.exit(
      approve({
        answer: { action: "cancel" },
        seen,
        supportsElicitation: true,
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
  })
);
