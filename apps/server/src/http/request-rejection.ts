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

/** Issue locations and categories only. Values, messages and annotations can echo request content. */
const issueSummary = (issue: Issue, path: string): ReadonlyArray<string> => {
  switch (issue._tag) {
    case "Pointer":
      return issueSummary(issue.issue, path + issue.path.map(segment).join(""));
    case "Encoding":
      return issueSummary(issue.issue, path);
    case "Composite":
      return issue.issues.flatMap((inner) => issueSummary(inner, path));
    // A union lists why each member rejected the value.
    case "AnyOf":
      return issue.issues.length === 0
        ? [`${path}: AnyOf`]
        : issue.issues.flatMap((inner) => issueSummary(inner, path));
    default:
      return [`${path}: ${issue._tag}`];
  }
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
      // Union members can repeat the same finding.
      const issues = [...new Set(issueSummary(error.cause.issue, "$"))];
      span.value.attribute("error.type", "HttpApiSchemaError");
      span.value.attribute("feeblo.request.rejection.kind", error.kind);
      span.value.attribute(
        "feeblo.request.rejection.issues",
        [
          ...issues.slice(0, maxIssues),
          ...(issues.length > maxIssues
            ? [`+${issues.length - maxIssues} more`]
            : []),
        ].join(", ")
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
