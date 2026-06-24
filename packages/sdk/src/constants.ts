export const CONTAINER_ID = "feeblo-embed-container";
export const FEEDBACK_ATTRIBUTE = "data-feeblo-feedback";
export const SCAN_INTERVAL_MS = 1000;
export const FADE_DURATION_MS = 150;

export const NAMESPACE = "feeblo";

export const CONTAINER_STYLES: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  width: "400px",
  height: "400px",
  maxHeight: "600px",
  margin: "0",
  top: "0",
  left: "0",
  opacity: "0",
  transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
  zIndex: "999999",
  display: "none",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow:
    "0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06), 0 12px 24px rgba(0, 0, 0, 0.08), 0 24px 48px rgba(0, 0, 0, 0.12)",
  border: "none",
};

export const EVENT_NAMES = [
  "widgetReady",
  "widgetOpened",
  "feedbackSubmitted",
] as const;
