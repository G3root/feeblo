import * as React from "react";

import { FeebloProvider, FeebloTrigger, useFeeblo } from "../index";

/**
 * Hub mode — the widget shows multiple modules (feedback + updates) behind a
 * tab bar. `openModule` lets you deep-link into the correct module.
 */
export function HubExample(): React.ReactElement {
  return (
    <FeebloProvider
      organizationId="org_demo"
      mode="hub"
      modules={["feedback", "updates"]}
      placement="bottom-right"
    >
      <HubInner />
    </FeebloProvider>
  );
}

function HubInner(): React.ReactElement {
  const { openModule } = useFeeblo();

  return (
    <div style={styles.card}>
      <p style={styles.meta}>Hub with two modules — placement: bottom-right (launcher)</p>
      <div style={styles.row}>
        <FeebloTrigger module="feedback" style={styles.primaryButton}>
          Feedback
        </FeebloTrigger>
        <FeebloTrigger module="updates" style={styles.secondaryButton}>
          What&apos;s new
        </FeebloTrigger>
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => openModule("updates")}
        >
          Open updates imperatively
        </button>
      </div>
    </div>
  );
}

/**
 * Board-scoped feedback — attach a board slug via `board` prop or `metadata`.
 * Only meaningful when the landing module is `feedback`.
 */
export function BoardScopedExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback" defaultBoard="roadmap">
      <div style={styles.row}>
        <FeebloTrigger board="roadmap" style={styles.primaryButton}>
          Roadmap feedback
        </FeebloTrigger>
        <FeebloTrigger board="bugs" style={styles.secondaryButton}>
          Report a bug
        </FeebloTrigger>
        <FeebloTrigger
          metadata={{ source: "pricing-page", plan: "pro" }}
          style={styles.secondaryButton}
        >
          Feedback with metadata
        </FeebloTrigger>
      </div>
    </FeebloProvider>
  );
}

/**
 * Totally placement-driven — no triggers, just the floating launcher.
 * Pass `placement` and skip triggers entirely.
 */
export function LauncherOnlyExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback" placement="bottom-left">
      <p style={styles.meta}>Widget launcher is rendered at bottom-left. No triggers needed.</p>
    </FeebloProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: 20,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    display: "grid",
    gap: 12,
  },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 12, color: "#6b7280", margin: 0 },
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
