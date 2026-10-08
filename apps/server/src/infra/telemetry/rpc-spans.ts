/**
 * RPC server spans carry the method in their name, but every call shares the
 * same `POST /rpc` HTTP route, so a backend grouping by route cannot tell two
 * methods apart. This decorates each RPC span with the standard RPC attributes
 * and records the method on its parent HTTP server span, which is the span a
 * trace groups by. One HTTP span can serve several RPC methods (a batch, or a
 * streaming request), so a shared span collects every method it saw instead of
 * letting the last one overwrite the rest.
 *
 * `effect/rpc` names each server span `${spanPrefix}.${tag}`; the prefix comes
 * from `@feeblo/domain/rpc-router` so the router and this filter cannot
 * disagree about the contract. A client that propagates its own trace context
 * makes the parent an external span, which cannot be annotated and is left
 * alone — the `rpc.*` attributes on the RPC span are still recorded.
 */
import { isArray, isString } from "@feeblo/utils/runtime-kind";
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
 * Adds `method` to a span that several RPC spans can share: the HTTP server
 * span a request hangs from, or that span seen through a link. The first
 * method stays a scalar; a second distinct method appends to a deduplicated
 * array instead of replacing the first, so no method a request served is lost.
 * The RPC span itself always gets the scalar method, because one span serves
 * one method.
 */
const addRpcMethodToSharedSpan = (span: Tracer.Span, method: string): void => {
  const existing = span.attributes.get("rpc.method");
  if (isString(existing)) {
    if (existing !== method) {
      span.attribute("rpc.method", [existing, method]);
    }
    return;
  }
  if (isArray(existing)) {
    if (!existing.includes(method)) {
      span.attribute("rpc.method", [...existing, method]);
    }
    return;
  }
  span.attribute("rpc.method", method);
};

/**
 * Wraps a tracer so every RPC server span records the method it serves.
 *
 * The attributes follow the OpenTelemetry RPC conventions: `rpc.system.name`
 * identifies the framework, `rpc.method` the operation. `rpc.method` is also
 * written onto the parent HTTP span because that is the operation a backend
 * lists and filters on; a shared span records all of its methods.
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
    // method is visible on whichever span the backend groups by. Either span
    // can be shared, so merge instead of overwriting.
    if (
      Option.isSome(spanOptions.parent) &&
      spanOptions.parent.value._tag === "Span"
    ) {
      addRpcMethodToSharedSpan(spanOptions.parent.value, method);
    }
    for (const link of spanOptions.links ?? []) {
      if (link.span._tag === "Span") {
        addRpcMethodToSharedSpan(link.span, method);
      }
    }
    return span;
  };
  return tracer.context === undefined
    ? { span }
    : { span, context: tracer.context };
};
