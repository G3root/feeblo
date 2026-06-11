import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function DashboardPendingShell() {
  return (
    <div className="pending-shell">
      <div className="pending-shell__sidebar">
        <div className="pending-shell__sidebar-inner" />
      </div>

      <main className="pending-shell__main">
        <div className="pending-shell__content">
          <div className="pending-shell__loading">
            <div className="pending-shell__animate-spin">
              <HugeiconsIcon
                aria-label="Loading"
                className={"pending-shell__spinner"}
                icon={Loading03Icon}
                role="status"
                strokeWidth={2}
              />
            </div>
            <span className="pending-shell__text">Loading...</span>
          </div>
        </div>
      </main>
    </div>
  );
}
