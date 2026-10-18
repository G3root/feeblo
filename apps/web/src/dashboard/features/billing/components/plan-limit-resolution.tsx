import { PLAN_FEATURE_CATALOG } from "@feeblo/domain/plan-entitlements";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Spinner } from "@feeblo/ui/spinner";
import { toastManager } from "@feeblo/ui/toast";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useOrgBoards } from "~/hooks/use-org-boards";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlanLock } from "~/hooks/use-plan-lock";
import { dashboardCollections } from "~/lib/collections";

type LockFeature = NonNullable<
  ReturnType<typeof usePlanLock>["data"]
>["current"]["features"][number];

const featureLabel = (feature: LockFeature, count: number) => {
  const definition = PLAN_FEATURE_CATALOG[feature.feature];
  return count === 1 ? definition.singularLabel : definition.pluralLabel;
};

/**
 * The locked-resource resolution surface: what the free plan blocks, which
 * resources stay usable, and the picker that moves the line. A write's remedy
 * (delete or export) stays available everywhere else; this page is the
 * positive control the banner points at.
 */
export function PlanLimitResolution() {
  const organizationId = useOrganizationId();
  const lock = usePlanLock();

  const state = lock.data?.current;

  if (!lock.data || !state) {
    return (
      <Card>
        <CardPanel className="flex items-center justify-center py-10">
          <Spinner />
        </CardPanel>
      </Card>
    );
  }

  if (state.plan !== "free") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing is locked</CardTitle>
          <CardDescription>
            The plan lock applies to free workspaces. This workspace is on{" "}
            {state.plan}.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lockedFeatures = state.features.filter(
    (feature) => feature.lockedIds.length > 0
  );

  if (lockedFeatures.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Everything is within the Free plan</CardTitle>
          <CardDescription>
            No resource is locked right now. If the plan changes, this page
            lists what locks and lets you keep the ones that matter.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {lockedFeatures.map((feature) => (
        <LockedFeatureCard
          feature={feature}
          key={feature.feature}
          organizationId={organizationId}
        />
      ))}
    </div>
  );
}

function LockedFeatureCard({
  feature,
  organizationId,
}: {
  feature: LockFeature;
  organizationId: string;
}) {
  const lockedCount = feature.lockedIds.length;
  const keptCount =
    feature.limit === null ? feature.count : feature.limit - lockedCount;
  const label = featureLabel(feature, 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>
            {PLAN_FEATURE_CATALOG[feature.feature].pluralLabel}
          </CardTitle>
          <Badge variant="error">{lockedCount} locked</Badge>
        </div>
        <CardDescription>
          The Free plan allows {feature.limit ?? "unlimited"} of{" "}
          {PLAN_FEATURE_CATALOG[feature.feature].pluralLabel.toLowerCase()}. You
          are keeping {Math.max(keptCount, 0)} and {lockedCount}{" "}
          {lockedCount === 1 ? "is" : "are"} locked: readable, exportable, and
          deletable, but not editable.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        {feature.feature === "feedbackBoards" ? (
          <BoardKeeperPicker
            feature={feature}
            organizationId={organizationId}
          />
        ) : feature.feature === "workspaces" ? (
          <WorkspaceKeeperPicker
            feature={feature}
            organizationId={organizationId}
          />
        ) : (
          <ReduceElsewhere
            feature={feature}
            organizationId={organizationId}
            label={label}
          />
        )}
      </CardPanel>
    </Card>
  );
}

/** Where each non-picker feature's remedy lives, or null when it is the picker. */
const reduceHref = (
  feature: LockFeature["feature"],
  organizationId: string
): string | null => {
  switch (feature) {
    case "changelogCategories":
      return `/${organizationId}/settings/changelog-categories`;
    case "crmEntries":
      return `/${organizationId}/contact`;
    case "privilegedMembers":
      return `/${organizationId}/settings/members`;
    default:
      return null;
  }
};

function ReduceElsewhere({
  feature,
  label,
  organizationId,
}: {
  feature: LockFeature;
  label: string;
  organizationId: string;
}) {
  const href = reduceHref(feature.feature, organizationId);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Locked {label.toLowerCase()} rows stay listed in their settings page.
        Delete the ones you no longer need to promote the next locked row, or
        upgrade to make them all editable again.
      </p>
      {href ? (
        <Button render={<Link to={href} />} size="sm" variant="outline">
          Open settings
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A keeper picker: `limit` slots, one checkbox per resource, and a save that
 * replaces the whole selection. Unchecked boxes are disabled at the cap, so
 * the UI can never ask the backend for an over-limit selection.
 */
function KeeperPicker({
  emptyText,
  feature,
  resources,
  onSave,
}: {
  emptyText: string;
  feature: LockFeature;
  resources: readonly { readonly id: string; readonly label: string }[];
  onSave: (resourceIds: readonly string[]) => Promise<void>;
}) {
  const derivedKept = useMemo(
    () =>
      resources
        .filter((resource) => !feature.lockedIds.includes(resource.id))
        .map((resource) => resource.id),
    [feature.lockedIds, resources]
  );
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const kept = selection ?? derivedKept;
  const limit = feature.limit ?? resources.length;

  const toggle = (id: string) => {
    const next = new Set(kept);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < limit) {
      next.add(id);
    }
    setSelection([...next]);
  };

  if (resources.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y rounded-lg border">
        {resources.map((resource) => {
          const isKept = kept.includes(resource.id);
          return (
            <label
              className="flex cursor-pointer items-center gap-3 px-3 py-2"
              key={resource.id}
            >
              <Checkbox
                checked={isKept}
                disabled={!isKept && kept.length >= limit}
                onCheckedChange={() => toggle(resource.id)}
              />
              <span className="text-sm">{resource.label}</span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button
          disabled={saving || selection === null}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(kept);
              setSelection(null);
            } finally {
              setSaving(false);
            }
          }}
          size="sm"
        >
          {saving ? <Spinner /> : null}
          Save selection
        </Button>
        <span className="text-muted-foreground text-xs">
          {kept.length} of {limit} kept
        </span>
      </div>
    </div>
  );
}

function BoardKeeperPicker({
  feature,
  organizationId,
}: {
  feature: LockFeature;
  organizationId: string;
}) {
  const { data: boards } = useOrgBoards(organizationId);

  const save = async (resourceIds: readonly string[]) => {
    try {
      await fetchRpc((rpc) =>
        rpc.SetWorkspacePlanLockSelection({
          featureKey: "feedbackBoards",
          organizationId,
          resourceIds: [...resourceIds],
        })
      );
      await dashboardCollections.workspacePlanLockCollection.utils.refetch({
        throwOnError: true,
      });
    } catch {
      toastManager.add({
        title: "Could not save the board selection.",
        type: "error",
      });
    }
  };

  return (
    <KeeperPicker
      emptyText="This workspace has no boards to choose from."
      feature={feature}
      onSave={save}
      resources={(boards ?? []).map((board) => ({
        id: board.id,
        label: board.name,
      }))}
    />
  );
}

function WorkspaceKeeperPicker({
  feature,
  organizationId,
}: {
  feature: LockFeature;
  organizationId: string;
}) {
  const creationState = useQuery({
    queryFn: () => fetchRpc((rpc) => rpc.GetWorkspaceCreationState()),
    queryKey: ["plan-limit-workspaces", organizationId],
  });

  const save = async (resourceIds: readonly string[]) => {
    try {
      await fetchRpc((rpc) =>
        rpc.SetWorkspacePlanLockSelection({
          featureKey: "workspaces",
          organizationId,
          resourceIds: [...resourceIds],
        })
      );
      await dashboardCollections.workspacePlanLockCollection.utils.refetch({
        throwOnError: true,
      });
      await creationState.refetch();
    } catch {
      toastManager.add({
        title: "Could not save the workspace selection.",
        type: "error",
      });
    }
  };

  return (
    <KeeperPicker
      emptyText="You own no free workspaces to choose from."
      feature={feature}
      onSave={save}
      resources={(creationState.data?.freeWorkspaces ?? []).map(
        (workspace) => ({
          id: workspace.id,
          label: workspace.name,
        })
      )}
    />
  );
}
