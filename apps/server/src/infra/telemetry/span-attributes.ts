/**
 * HTTP span attributes are allowlisted before any exporter sees them.
 *
 * Effect's HTTP client and server tracers write the full URL, the query string
 * and every request/response header onto their spans. Feeblo carries bearer
 * capabilities in query strings (unsubscribe and verification links, widget
 * SSO) and credentials in headers chosen by third-party APIs, so no list of
 * dangerous names can keep up. Attributes in an HTTP namespace record only the
 * fixed set below; product namespaces pass through untouched.
 *
 * The filter runs on the tracer because that is the one point where the client
 * tracer and the server tracer meet; a per-client header filter would miss the
 * server side and could not touch `url.full`. Ported from
 * `UsefulSoftwareCo/executor`'s `packages/telemetry/src/span-attributes.ts`.
 */
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/** Namespaces the HTTP client and server tracers write into. */
const httpNamespaces = ["http.", "url.", "server.", "client.", "user_agent."];

/** Every HTTP attribute an exported span may carry. */
export const httpSpanAttributeAllowlist: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.response.status_code",
  "server.address",
  "url.scheme",
  // Path only. `url.full` and `url.query` carry the query string.
  "url.path",
  "http.request.header.content-type",
  "http.request.header.content-length",
  "http.request.header.user-agent",
  "http.response.header.content-type",
  "http.response.header.content-length",
  // The server tracer records the user agent a second time under its own name.
  "user_agent.original",
]);

/** Record this attribute? HTTP names must be allowlisted; product names pass through. */
export const spanAttributeAllowed = (key: string): boolean => {
  const name = key.toLowerCase();
  return (
    !httpNamespaces.some((namespace) => name.startsWith(namespace)) ||
    httpSpanAttributeAllowlist.has(name)
  );
};

/** The open attribute map the tracer interface defines for events. */
type SpanAttributeMap = NonNullable<Parameters<Tracer.Span["event"]>[2]>;

const allowedEntries = (attributes: SpanAttributeMap): SpanAttributeMap =>
  Object.fromEntries(
    Object.entries(attributes).filter(([key]) => spanAttributeAllowed(key))
  );

/**
 * Delegate to the real span and drop disallowed attributes before they are set.
 * The exporter still sees one span; the values simply never arrive.
 */
const allowlistedSpan = (span: Tracer.Span): Tracer.Span => ({
  _tag: "Span",
  get name() {
    return span.name;
  },
  get spanId() {
    return span.spanId;
  },
  get traceId() {
    return span.traceId;
  },
  get parent() {
    return span.parent;
  },
  get annotations() {
    return span.annotations;
  },
  get status() {
    return span.status;
  },
  get attributes() {
    return span.attributes;
  },
  get links() {
    return span.links;
  },
  get sampled() {
    return span.sampled;
  },
  get kind() {
    return span.kind;
  },
  end: (endTime, exit) => span.end(endTime, exit),
  attribute: (key, value) => {
    if (spanAttributeAllowed(key)) {
      span.attribute(key, value);
    }
  },
  event: (name, startTime, attributes) =>
    span.event(
      name,
      startTime,
      attributes === undefined ? undefined : allowedEntries(attributes)
    ),
  addLinks: (links) => span.addLinks(links),
});

/**
 * Root spans that are library internals rather than operations.
 *
 * Background fibers (queue pollers, delivery workers) execute SQL without a
 * parent request, so Effect SQL's spans arrive as roots and every poll turns
 * into a standalone trace. A SQL span under a request keeps its parent and is
 * still exported; only the orphan poller queries are dropped. The names are
 * exact because the library owns them.
 */
export const rootSpanNoise: ReadonlySet<string> = new Set([
  "sql.execute",
  "sql.transaction",
]);

/**
 * Wraps a tracer with the attribute filter and ratio sampling.
 *
 * A root span is sampled at `sampleRate`; a child always keeps its parent's
 * decision, so a retained trace stays whole and a dropped one stays cheap.
 * Root spans named in `dropRootSpans` are never exported: they are emitted by
 * library internals (see `rootSpanNoise`) rather than by a request or a named
 * operation. `Math.random` is the ratio-sampler primitive an OpenTelemetry SDK
 * uses: span creation is synchronous and cannot read Effect's `Random`
 * service.
 */
export const allowedSpans = (
  tracer: Tracer.Tracer,
  options?: {
    readonly sampleRate?: number | undefined;
    readonly dropRootSpans?: ReadonlySet<string> | undefined;
  }
): Tracer.Tracer => {
  const sampleRate = Math.min(1, Math.max(0, options?.sampleRate ?? 1));
  const dropRootSpans = options?.dropRootSpans ?? rootSpanNoise;
  const span = (
    spanOptions: Parameters<Tracer.Tracer["span"]>[0]
  ): Tracer.Span => {
    // The runtime already computed `sampled` for a child, including
    // `MinimumTraceLevel`. A root arrives as `true` unless something
    // explicitly disabled it, and that default is what ratio sampling
    // replaces; an explicit root `sampled: false` is kept.
    const sampled = Option.isSome(spanOptions.parent)
      ? spanOptions.sampled
      : spanOptions.sampled &&
        !dropRootSpans.has(spanOptions.name) &&
        // oxlint-disable-next-line effecttsgo/global-random -- ratio sampling is a synchronous span-creation decision and cannot read Effect's Random service
        Math.random() < sampleRate;
    return allowlistedSpan(tracer.span({ ...spanOptions, sampled }));
  };
  return tracer.context === undefined
    ? { span }
    : { span, context: tracer.context };
};
