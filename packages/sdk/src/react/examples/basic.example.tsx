import * as React from "react";

import { FeebloProvider, FeebloTrigger, useFeeblo, useFeebloEvent } from "../index";

/**
 * Minimal integration — wrap your app in FeebloProvider and drop a trigger
 * wherever you want the widget to be anchored.
 */
export function BasicExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback">
      <header style={styles.header}>
        <h1>Acme App</h1>
        <FeebloTrigger style={styles.primaryButton}>Give feedback</FeebloTrigger>
      </header>
    </FeebloProvider>
  );
}

/**
 * Controlled open/close — shows how to drive the widget imperatively via
 * `useFeeblo()` without a trigger element.
 */
export function ControlledExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback">
      <ControlledInner />
    </FeebloProvider>
  );
}

function ControlledInner(): React.ReactElement {
  const { isOpen, isReady, open, close } = useFeeblo();

  return (
    <div style={styles.card}>
      <p style={styles.meta}>
        {isReady ? "Widget ready" : "Loading widget…"} · {isOpen ? "Open" : "Closed"}
      </p>
      <div style={styles.row}>
        <button type="button" onClick={() => open()} style={styles.primaryButton}>
          Open widget
        </button>
        <button type="button" onClick={() => close()} style={styles.secondaryButton}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Listening to widget events — e.g. to show a toast when feedback is submitted
 * or to track analytics.
 */
export function EventsExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback">
      <EventsInner />
    </FeebloProvider>
  );
}

function EventsInner(): React.ReactElement {
  const [lastFeedback, setLastFeedback] = React.useState<string | null>(null);

  useFeebloEvent("feedbackSubmitted", (event) => {
    setLastFeedback(event.detail.data?.title ?? "(no title)");
  });

  useFeebloEvent("widgetOpened", () => {
    console.log("[example] widget opened");
  });

  return (
    <div style={styles.card}>
      <FeebloTrigger style={styles.primaryButton}>Share feedback</FeebloTrigger>
      {lastFeedback && <p style={styles.success}>Thanks! Submitted: {lastFeedback}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  },
  card: {
    padding: 20,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    display: "grid",
    gap: 12,
  },
  row: { display: "flex", gap: 8 },
  meta: { fontSize: 12, color: "#6b7280", margin: 0 },
  success: { fontSize: 13, color: "#047857", margin: 0 },
  primaryButton: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #111827",
    background: "#111827",
    color: "white",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "white",
    cursor: "pointer",
  },
};
