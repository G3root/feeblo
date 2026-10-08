/**
 * RPC server spans carry the method in their name, but every call shares the
 * same `POST /rpc` HTTP route, so a backend grouping by route cannot tell two
 * methods apart. This decorates each RPC span with the standard RPC attributes
 * and copies the method onto its parent HTTP server span, which is the span a
 * trace groups by.
 *
 * `effect/rpc` names each server span `${spanPrefix}.${tag}`; the prefix comes
 * from `@feeblo/domain/rpc-router` so the router and this filter cannot
 * disagree about the contract. A client that propagates its own trace context
 * makes the parent an external span, which cannot be annotated and is left
 * alone — the `rpc.*` attributes on the RPC span are still recorded.
 */
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/** The method of an RPC server span, or `undefined` for any other span. */
export const rpcMethodFromSpanName = (
  name: string,
  spanPrefix: string
): string | undefined =>
  name.startsWith(`${spanPrefix}.`)
    ? name.slice(spanPrefix.length + 1)
    : undefined;

/**
 * Wraps a tracer so every RPC server span records the method it serves.
 *
 * The attributes follow the OpenTelemetry RPC conventions: `rpc.system.name`
 * identifies the framework, `rpc.method` the operation. `rpc.method` is also
 * written onto the parent HTTP span because that is the operation a backend
 * lists and filters on.
 */
export const rpcSpans = (
  tracer: Tracer.Tracer,
  options: { readonly spanPrefix: string }
): Tracer.Tracer => {
  const span = (
    spanOptions: Parameters<Tracer.Tracer["span"]>[0]
  ): Tracer.Span => {
    const method = rpcMethodFromSpanName(spanOptions.name, options.spanPrefix);
    const span = tracer.span(spanOptions);
    if (method === undefined) {
      return span;
    }
    span.attribute("rpc.system.name", "effect");
    span.attribute("rpc.method", method);
    // The parent is the HTTP server span for an in-process call. When the
    // client propagates its own trace context the RPC span hangs from that
    // external span and the HTTP span is only a link; label both so the
    // method is visible on whichever span the backend groups by.
    if (
      Option.isSome(spanOptions.parent) &&
      spanOptions.parent.value._tag === "Span"
    ) {
      spanOptions.parent.value.attribute("rpc.method", method);
    }
    for (const link of spanOptions.links ?? []) {
      if (link.span._tag === "Span") {
        link.span.attribute("rpc.method", method);
      }
    }
    return span;
  };
  return tracer.context === undefined
    ? { span }
    : { span, context: tracer.context };
};
