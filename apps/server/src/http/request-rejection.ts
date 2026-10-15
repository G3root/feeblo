/**
 * Request decoding rejections are client errors. Effect's HTTP API answers
 * them with an empty 400 before any handler runs, so the request span is the
 * only place that can record why. This records issue locations and categories
 * only; a value, message, or annotation can echo the caller's content.
 *
 * Ported from `UsefulSoftwareCo/executor`'s
 * `packages/telemetry/src/request-rejection.ts`.
 */
import { isNumber } from "@feeblo/utils/runtime-kind";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";
import { HttpApiError } from "effect/http-api";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as Option from "effect/Option";
import type { Issue } from "effect/SchemaIssue";
import * as Tracer from "effect/Tracer";

/** Request parts the caller supplies. Response encoding failures are server faults. */
const requestKinds: ReadonlySet<HttpApiError.HttpApiSchemaError["kind"]> =
  new Set(["Params", "Headers", "Query", "Payload"]);

/** Did an endpoint reject the shape of the caller's request? */
export const isRequestRejection = (
  cause: unknown
): cause is HttpApiError.HttpApiSchemaError =>
  HttpApiError.HttpApiSchemaError.is(cause) && requestKinds.has(cause.kind);

const maxIssues = 10;

/** Numeric keys index arrays; every other key names an object field. */
const segment = (key: PropertyKey) =>
  isNumber(key) ? `[${key}]` : `.${String(key).slice(0, 64)}`;

/**
 * Issue locations and categories only, yielded lazily. Values, messages and
 * annotations can echo request content, and a large request can carry a large
 * issue tree; the caller stops once it has enough findings.
 */
function* issueSummaries(issue: Issue, path: string): Generator<string> {
  switch (issue._tag) {
    case "Pointer":
      yield* issueSummaries(
        issue.issue,
        path + issue.path.map(segment).join("")
      );
      return;
    case "Encoding":
      yield* issueSummaries(issue.issue, path);
      return;
    case "Composite":
      for (const inner of issue.issues) {
        yield* issueSummaries(inner, path);
      }
      return;
    // A union lists why each member rejected the value.
    case "AnyOf":
      if (issue.issues.length === 0) {
        yield `${path}: AnyOf`;
        return;
      }
      for (const inner of issue.issues) {
        yield* issueSummaries(inner, path);
      }
      return;
    default:
      yield `${path}: ${issue._tag}`;
  }
}

/** The first `maxIssues` unique summaries, and whether the tree held more. */
interface CollectedIssues {
  readonly issues: ReadonlyArray<string>;
  readonly truncated: boolean;
}

const collectIssues = (issue: Issue): CollectedIssues => {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const summary of issueSummaries(issue, "$")) {
    if (seen.has(summary)) {
      continue;
    }
    seen.add(summary);
    if (issues.length === maxIssues) {
      return { issues, truncated: true };
    }
    issues.push(summary);
  }
  return { issues, truncated: false };
};

/** Record the rejection on the span that owns the rejected request. */
const reporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    for (const reason of cause.reasons) {
      const error =
        reason._tag === "Fail"
          ? reason.error
          : reason._tag === "Die"
            ? reason.defect
            : undefined;
      if (!isRequestRejection(error)) {
        continue;
      }
      const span = Context.getOption(fiber.context, Tracer.ParentSpan);
      if (Option.isNone(span) || span.value._tag !== "Span") {
        return;
      }
      const { issues, truncated } = collectIssues(error.cause.issue);
      span.value.attribute("error.type", "HttpApiSchemaError");
      span.value.attribute("feeblo.request.rejection.kind", error.kind);
      span.value.attribute(
        "feeblo.request.rejection.issues",
        [...issues, ...(truncated ? ["+more"] : [])].join(", ")
      );
      return;
    }
  },
};

/** Wrap a request handler so HTTP API request rejections are recorded on its span. */
export const recordRequestRejections = <A, E, R>(
  handler: Effect.Effect<A, E, R>
) =>
  Effect.withFiber((fiber) =>
    Effect.provideService(
      handler,
      ErrorReporter.CurrentErrorReporters,
      new Set([...fiber.getRef(ErrorReporter.CurrentErrorReporters), reporter])
    )
  );

/** The middleware as the composition root installs it. */
export const requestRejectionMiddleware = HttpMiddleware.make((httpApp) =>
  recordRequestRejections(httpApp)
);
