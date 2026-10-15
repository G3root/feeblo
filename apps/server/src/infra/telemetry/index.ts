export {
  TelemetryConfig,
  TelemetryTarget,
  telemetryConfig,
  telemetryRequestTimeout,
} from "./config";
export { defaultTelemetryLogger, telemetryLayer } from "./layer";
export { startProcessMetrics } from "./process";
export {
  allowedSpans,
  httpSpanAttributeAllowlist,
  recordRoute,
  rootSpanNoise,
  routeTemplates,
  spanAttributeAllowed,
} from "./span-attributes";
export { telemetryHttpClient } from "./transport";
