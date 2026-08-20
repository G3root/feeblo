import * as React from "react";

import { FeebloProvider, FeebloTrigger, useFeeblo } from "../index";
import type { UserIdentity } from "../../types";

/**
 * Passing `user` to the provider — the widget is (re)-identified whenever the
 * identity object changes. The value is stringified internally so object
 * identity churn doesn't cause extra network calls.
 */
export function IdentifyExample(): React.ReactElement {
  const [user, setUser] = React.useState<UserIdentity>({
    id: "u_1",
    name: "Ada Lovelace",
    email: "ada@example.com",
  });

  return (
    <FeebloProvider organizationId="org_demo" user={user} mode="feedback">
      <div style={styles.stack}>
        <div style={styles.card}>
          <strong>{user.name}</strong>
          <span style={styles.meta}>{user.email}</span>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() =>
                setUser({
                  id: "u_2",
                  name: "Grace Hopper",
                  email: "grace@example.com",
                })
              }
            >
              Switch user
            </button>
            <IdentifyButton />
          </div>
        </div>
        <FeebloTrigger style={styles.primaryButton}>Give feedback as {user.name}</FeebloTrigger>
      </div>
    </FeebloProvider>
  );
}

function IdentifyButton(): React.ReactElement {
  const { identify } = useFeeblo();

  return (
    <button
      type="button"
      style={styles.secondaryButton}
      onClick={() =>
        identify({
          id: "u_3",
          name: "Margaret Hamilton",
          email: "margaret@example.com",
          customFields: { role: "Engineer" },
          companies: [{ id: "c_1", name: "Acme" }],
        })
      }
    >
      Identify via hook
    </button>
  );
}

/**
 * Totally unauthenticated — omit `user` and the widget renders for anonymous
 * visitors. Call `identify` later when the user signs in.
 */
export function AnonymousThenIdentifyExample(): React.ReactElement {
  return (
    <FeebloProvider organizationId="org_demo" mode="feedback">
      <AnonymousInner />
    </FeebloProvider>
  );
}

function AnonymousInner(): React.ReactElement {
  const { identify } = useFeeblo();
  const [signedIn, setSignedIn] = React.useState(false);

  const handleSignIn = React.useCallback(() => {
    identify({
      id: "u_42",
      email: "user@example.com",
      name: "Signed In User",
    });
    setSignedIn(true);
  }, [identify]);

  return (
    <div style={styles.card}>
      <p style={styles.meta}>{signedIn ? "Signed in" : "Anonymous visitor"}</p>
      {!signedIn && (
        <button type="button" style={styles.primaryButton} onClick={handleSignIn}>
          Sign in & identify
        </button>
      )}
      <FeebloTrigger style={styles.secondaryButton}>Feedback</FeebloTrigger>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  stack: { display: "grid", gap: 16 },
  card: {
    padding: 20,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    display: "grid",
    gap: 8,
  },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 12, color: "#6b7280" },
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
