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
 * A matched server span records its route template in `url.path` in place of
 * the concrete path, so a path parameter such as the SES webhook's signing
 * token never reaches the backend. `recordRoute` and `routeTemplates` name a
 * request served under a wildcard route.
 *
 * The filter runs on the tracer because that is the one point where the client
 * tracer and the server tracer meet; a per-client header filter would miss the
 * server side and could not touch `url.full`. Ported from
 * `UsefulSoftwareCo/executor`'s `packages/telemetry/src/span-attributes.ts`.
 */
import { isString } from "@feeblo/utils/runtime-kind";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/** Namespaces the HTTP client and server tracers write into. */
const httpNamespaces = ["http.", "url.", "server.", "client.", "user_agent."];

/** Every HTTP attribute an exported span may carry. */
export const httpSpanAttributeAllowlist: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.response.status_code",
  // The router's matched route template, e.g. `/api/v1/posts/:postId`.
  "http.route",
  "server.address",
  "url.scheme",
  // Path only, and the route template once the router matches. `url.full` and
  // `url.query` carry the query string, so neither is listed.
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

/**
 * Record the template of a route whose path a caller chose, in place of the
 * router's wildcard: a fixed endpoint served under a wildcard mount. Its last
 * parameter stands for the rest of the path. Call it from the request's
 * handler, because it annotates the current span.
 */
export const recordRoute = (template: `/${string}`) =>
  Effect.annotateCurrentSpan("http.route", template);

/**
 * A fixed set of endpoint templates served under one wildcard route, such as
 * Better Auth's endpoints under `/api/auth/*`. `:name` stands for one segment.
 * `record` names the request's endpoint by its template and leaves the
 * wildcard for any path the set does not hold, so a span keeps which endpoint
 * ran without any segment the caller chose.
 */
export const routeTemplates = (templates: Iterable<`/${string}`>) => {
  // A fixed segment wins over a parameter in the same place, as in the routers
  // these serve.
  const known = [...new Set(templates)]
    .map((template) => ({ template, segments: template.split("/") }))
    .sort(
      (a, b) =>
        a.segments.filter((segment) => segment.startsWith(":")).length -
        b.segments.filter((segment) => segment.startsWith(":")).length
    );
  const match = (path: string) => {
    const segments = path.split("/");
    return known.find(
      (route) =>
        route.segments.length === segments.length &&
        route.segments.every((segment, index) =>
          segment.startsWith(":")
            ? segments[index] !== ""
            : segment === segments[index]
        )
    )?.template;
  };
  return {
    match,
    record: (path: string) => {
      const template = match(path);
      return template === undefined ? Effect.void : recordRoute(template);
    },
  };
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
 *
 * Once the router records a server span's route, its `url.path` becomes that
 * route's template. The router sets `http.route` after the request middleware
 * writes `url.path`, but the order is not part of the tracer contract, so both
 * arrivals are handled and whichever came first is replaced.
 */
const allowlistedSpan = (span: Tracer.Span): Tracer.Span => {
  let path = false;
  let route: string | undefined;
  return {
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
      if (!spanAttributeAllowed(key)) {
        return;
      }
      if (key === "url.path" && isString(value)) {
        path = true;
        span.attribute(key, route ?? value);
        return;
      }
      if (key === "http.route" && isString(value)) {
        route = value;
        if (path) {
          span.attribute("url.path", value);
        }
      }
      span.attribute(key, value);
    },
    event: (name, startTime, attributes) =>
      span.event(
        name,
        startTime,
        attributes === undefined ? undefined : allowedEntries(attributes)
      ),
    addLinks: (links) => span.addLinks(links),
  };
};

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
