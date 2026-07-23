import { ChangelogId } from "@feeblo/id";
import { toastManager } from "@feeblo/ui/toast";
import { slugify } from "@feeblo/utils/url";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasMembership, usePolicy } from "@feeblo/web-shared/use-policy";
import { and, eq, queryOnce } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import type { ChangelogStatus } from "../constants";

export const useChangelogAction = () => {
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  const { changelogCollection, membersCollection } = useDashboardCollections();
  const { data: session } = useAuthState();
  const { allowed: canCreate } = usePolicy(hasMembership(organizationId));

  const createChangeLog = async () => {
    if (!canCreate) {
      return;
    }

    if (!session) {
      return;
    }

    const member = await queryOnce((q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) =>
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, session.user.id)
          )
        )
        .select(({ member }) => ({
          id: member.id,
        }))
        .findOne()
    );

    try {
      const id = await ChangelogId.unsafeGenerate();
      const title = "Untitled changelog";
      const slug = `${slugify(title) || "changelog"}-${id.slice(-6)}`;
      const tx = changelogCollection.insert({
        id,
        title,
        slug,
        content: "",
        status: "draft" as ChangelogStatus,
        scheduledAt: null,
        publishedAt: null,
        organizationId,
        creatorId: session?.user?.id ?? null,
        creatorMemberId: member?.id ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          name: session?.user?.name ?? null,
          image: session?.user?.image ?? null,
        },
      });

      await tx.isPersisted.promise;
      trackEvent("changelog_created", { success: true });

      navigate({
        to: "/$organizationId/changelog/edit/$changelogSlug",
        params: { organizationId, changelogSlug: slug },
      });
    } catch (_error) {
      trackEvent("changelog_created", { success: false });
      toastManager.add({
        title: "Failed to create changelog",
        type: "error",
      });
    }
  };

  return { createChangeLog, canCreate };
};
