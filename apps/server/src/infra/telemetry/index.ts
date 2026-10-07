export {
  TelemetryConfig,
  TelemetryTarget,
  telemetryConfig,
  telemetryRequestTimeout,
} from "./config";
export { defaultTelemetryLogger, telemetryLayer } from "./layer";
export {
  allowedSpans,
  httpSpanAttributeAllowlist,
  spanAttributeAllowed,
} from "./span-attributes";
