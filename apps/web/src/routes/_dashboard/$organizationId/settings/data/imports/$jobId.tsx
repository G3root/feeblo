import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { ImportReviewPage } from "~/features/data-transfer/components/import-review-page";
import { reviewSearchSchema } from "~/features/data-transfer/search";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/data/imports/$jobId"
)({
  component: ImportReviewRoute,
  validateSearch: (search) => reviewSearchSchema.parse(search),
});

function ImportReviewRoute() {
  const organizationId = useOrganizationId();
  const { jobId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "boards.importPosts")
  );

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <ImportReviewPage
      jobId={jobId}
      onSearchChange={(patch) => {
        void navigate({
          params: { jobId, organizationId },
          search: { ...search, ...patch },
          to: "/$organizationId/settings/data/imports/$jobId",
        });
      }}
      organizationId={organizationId}
      search={search}
    />
  );
}
