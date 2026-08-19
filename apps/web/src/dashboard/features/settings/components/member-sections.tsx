import {
  compareRoles,
  INVITABLE_ROLES,
  type InvitableRole,
  type Role,
} from "@feeblo/permissions";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@feeblo/ui/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  hasOwnerOrAdminRole,
  hasPermission,
  PolicyGuard,
} from "@feeblo/web-shared/use-policy";
import { Delete02Icon, Plus, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import * as React from "react";
import { z } from "zod";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { MembersSettingsLayout } from "~/features/settings/components/settings-members-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePrivilegedMemberLimit } from "~/hooks/use-privileged-member-limit";
import { invitationsCollection, membersCollection } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

interface OrganizationMemberRow {
  id: string;
  organizationId: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  userId: string;
}

interface OrganizationInvitationRow {
  createdAt: Date | string;
  email: string;
  expiresAt: Date | string;
  id: string;
  inviterId: string;
  organizationId: string;
  role: string | null;
  status: string;
}

export function MembersSection() {
  const organizationId = useOrganizationId();
  const { data: session } = useAuthState();
  const { atLimit: atPrivilegedLimit } = usePrivilegedMemberLimit();
  const [search, setSearch] = React.useState("");

  const membersQuery = useLiveQuery(
    (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
    [organizationId]
  );
  const membersData = membersQuery.data;
  const members = React.useMemo(() => {
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    const membersSource = (membersData ?? []) as OrganizationMemberRow[];
    const term = search.trim().toLowerCase();
    if (!term) {
      return membersSource;
    }

    return membersSource.filter((member) => {
      const name = member.user?.name?.toLowerCase() ?? "";
      const email = member.user?.email?.toLowerCase() ?? "";
      return name.includes(term) || email.includes(term);
    });
  }, [membersData, search]);

  const noFilter = members.length === 0 && search.trim() !== "";
  const isEmpty = (membersData?.length ?? 0) === 0;

  if (membersQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        <MembersSettingsLayout.Section title="Members">
          <MembersSectionControls
            controls={
              <>
                <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
                  <InviteMemberForm />
                </PolicyGuard>
                <MembersSearchInput
                  onChange={setSearch}
                  placeholder="Search by name or email..."
                  value={search}
                />
              </>
            }
          />
          <MembersSettingsLayout.List>
            {memberLoadingIds.map((id) => (
              <MemberListItemLoading key={id} />
            ))}
          </MembersSettingsLayout.List>
        </MembersSettingsLayout.Section>
      </SkeletonLoader>
    );
  }

  if (membersQuery.isError) {
    return (
      <MembersSettingsLayout.Section title="Members">
        <MembersSectionControls
          controls={
            <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
              <InviteMemberForm />
            </PolicyGuard>
          }
        />
        <MembersSectionErrorState
          description="There was a problem loading members. Try refreshing the page."
          title="Unable to load members"
        />
      </MembersSettingsLayout.Section>
    );
  }

  return (
    <MembersSettingsLayout.Section title="Members">
      <MembersSectionControls
        controls={
          <>
            <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
              <InviteMemberForm />
            </PolicyGuard>
            {isEmpty ? null : (
              <MembersSearchInput
                onChange={setSearch}
                placeholder="Search by name or email..."
                value={search}
              />
            )}
          </>
        }
      />

      {noFilter ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} />
            </EmptyMedia>
            <EmptyTitle>No members found for this filter</EmptyTitle>
            <EmptyDescription>
              Try a different search term or clear the filter.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setSearch("")} size="sm" variant="secondary">
              Reset filter
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No members yet</EmptyTitle>
            <EmptyDescription>
              Invite a new member to start collaborating.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {noFilter || isEmpty ? null : (
        <MembersSettingsLayout.List>
          {members.map((member) => {
            // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
            const role = member.role.split(",")[0] as Role;
            const isOwner = member.role.split(",").includes("owner");
            const isCurrentUser = member.userId === session?.user?.id;

            return (
              <MemberListItem
                atPrivilegedLimit={atPrivilegedLimit}
                email={member.user?.email || "No email"}
                id={member.id}
                isCurrentUser={isCurrentUser}
                isOwner={isOwner}
                key={member.id}
                name={member.user?.name || "Unnamed user"}
                organizationId={organizationId}
                role={role}
              />
            );
          })}
        </MembersSettingsLayout.List>
      )}
    </MembersSettingsLayout.Section>
  );
}

export function InvitationsSection() {
  const organizationId = useOrganizationId();
  const [search, setSearch] = React.useState("");

  const invitationsQuery = useLiveQuery(
    (q) => {
      return q
        .from({ invitation: invitationsCollection })
        .where(({ invitation }) =>
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, "pending")
          )
        );
    },
    [organizationId]
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  );
  const invitationsData = invitationsQuery.data;
  const invitations = React.useMemo(() => {
    // SAFETY: The upstream contract guarantees this value here.
    const invitationsSource = (invitationsData ??
      []) as OrganizationInvitationRow[];
    const term = search.trim().toLowerCase();
    if (!term) {
      return invitationsSource;
    }

    return invitationsSource.filter((invitation) =>
      invitation.email.toLowerCase().includes(term)
    );
  }, [invitationsData, search]);

  const noFilter = invitations.length === 0 && search.trim() !== "";
  const isEmpty = (invitationsData?.length ?? 0) === 0;

  if (invitationsQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        <MembersSettingsLayout.Section title="Invitations">
          <MembersSectionControls
            controls={
              <MembersSearchInput
                onChange={setSearch}
                placeholder="Search by email..."
                value={search}
              />
            }
          />
          <MembersSettingsLayout.List>
            {invitationLoadingIds.map((id) => (
              <InvitationListItemLoading key={id} />
            ))}
          </MembersSettingsLayout.List>
        </MembersSettingsLayout.Section>
      </SkeletonLoader>
    );
  }

  if (invitationsQuery.isError) {
    return (
      <MembersSettingsLayout.Section title="Invitations">
        <MembersSectionErrorState
          description="There was a problem loading invitations. Try refreshing the page."
          title="Unable to load invitations"
        />
      </MembersSettingsLayout.Section>
    );
  }

  return (
    <MembersSettingsLayout.Section title="Invitations">
      {isEmpty ? null : (
        <MembersSectionControls
          controls={
            <MembersSearchInput
              onChange={setSearch}
              placeholder="Search by email..."
              value={search}
            />
          }
        />
      )}

      {noFilter ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} />
            </EmptyMedia>
            <EmptyTitle>No invitations found for this filter</EmptyTitle>
            <EmptyDescription>
              Try a different search term or clear the filter.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setSearch("")} size="sm" variant="secondary">
              Reset filter
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No pending invitations</EmptyTitle>
            <EmptyDescription>
              Invite a member to send the first invitation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {noFilter || isEmpty ? null : (
        <MembersSettingsLayout.List>
          {invitations.map((invitation) => (
            <InvitationListItem
              email={invitation.email}
              expiresAt={invitation.expiresAt}
              id={invitation.id}
              key={invitation.id}
              organizationId={organizationId}
              role={invitation.role || "manager"}
            />
          ))}
        </MembersSettingsLayout.List>
      )}
    </MembersSettingsLayout.Section>
  );
}

function MembersSectionControls({ controls }: { controls: React.ReactNode }) {
  return (
    <MembersSettingsLayout.Controls>{controls}</MembersSettingsLayout.Controls>
  );
}

function MembersSearchInput({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <SkeletonWrapper>
      <InputGroup>
        <InputGroupInput
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={value}
        />
        <InputGroupAddon align="inline-end">
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupAddon>
      </InputGroup>
    </SkeletonWrapper>
  );
}

function MembersSectionErrorState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function MemberListItem({
  atPrivilegedLimit,
  email,
  id,
  isCurrentUser,
  isOwner,
  name,
  organizationId,
  role,
}: {
  atPrivilegedLimit: boolean;
  email: string;
  id: string;
  isCurrentUser: boolean;
  isOwner: boolean;
  name: string;
  organizationId: string;
  role: Role;
}) {
  const { membersCollection } = useDashboardCollections();
  const { data: session } = useAuthState();
  const actorRole = session?.memberships.find(
    (membership) => membership.organizationId === organizationId
  )?.role;
  const canManageTarget =
    actorRole !== undefined && compareRoles(role, actorRole) === -1;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {name}
          {isCurrentUser ? " (You)" : ""}
        </p>
        <p className="text-muted-foreground truncate text-xs">{email}</p>
      </div>

      <div className="flex items-center gap-2">
        <PolicyGuard policy={hasPermission(organizationId, "members.assign")}>
          {({ allowed }) => (
            <Select
              onValueChange={async (value) => {
                if (!value) {
                  throw new Error("value not found");
                  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                }
                // SAFETY: The upstream contract guarantees this value here.
                const tx = membersCollection.update(id, (draft) => {
                  // SAFETY: The upstream contract guarantees this value here.
                  draft.role = value as Role;
                });
                try {
                  await tx.isPersisted.promise;
                  trackEvent("org_member_role_changed", {
                    role: value,
                    success: true,
                  });
                  toastManager.add({
                    title: "Member role updated",
                    type: "success",
                  });
                } catch {
                  trackEvent("org_member_role_changed", {
                    role: value,
                    success: false,
                  });
                  toastManager.add({
                    title: "Failed to update role",
                    type: "error",
                  });
                }
              }}
              value={role}
            >
              <SelectTrigger
                className="w-28"
                disabled={!(allowed && canManageTarget)}
                title={
                  allowed
                    ? undefined
                    : "You don't have permission to change roles"
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {isOwner ? <SelectItem value="owner">Owner</SelectItem> : null}
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="contributor">Contributor</SelectItem>
                <SelectItem
                  disabled={atPrivilegedLimit && role !== "admin"}
                  value="admin"
                >
                  Admin
                </SelectItem>
              </SelectPopup>
            </Select>
          )}
        </PolicyGuard>

        <PolicyGuard policy={hasPermission(organizationId, "members.remove")}>
          {({ allowed }) => (
            <Button
              aria-label={`Remove ${name}`}
              disabled={!(allowed && canManageTarget) || isCurrentUser}
              onClick={async () => {
                const tx = membersCollection.delete(id);
                try {
                  await tx.isPersisted.promise;
                  trackEvent("org_member_removed", { success: true });
                  toastManager.add({
                    title: "Member removed",
                    type: "success",
                  });
                } catch {
                  trackEvent("org_member_removed", { success: false });
                  toastManager.add({
                    title: "Failed to remove member",
                    type: "error",
                  });
                }
              }}
              size="icon-sm"
              title={
                allowed
                  ? undefined
                  : "You don't have permission to remove members"
              }
              type="button"
              variant="destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} />
            </Button>
          )}
        </PolicyGuard>
      </div>
    </div>
  );
}

function MemberListItemLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <SkeletonWrapper>
          <p className="truncate text-sm font-medium">Loading member</p>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <p className="text-muted-foreground truncate text-xs">
            loading@example.com
          </p>
        </SkeletonWrapper>
      </div>

      <div className="flex items-center gap-2">
        <SkeletonWrapper>
          <Button size="sm" type="button" variant="outline">
            Member
          </Button>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <Button size="icon-sm" type="button" variant="destructive">
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        </SkeletonWrapper>
      </div>
    </div>
  );
}

function InvitationListItem({
  email,
  expiresAt,
  id,
  organizationId,
  role,
}: {
  email: string;
  expiresAt: Date | string;
  id: string;
  organizationId: string;
  role: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">{email}</p>
        <p className="text-muted-foreground text-xs">Invited as {role}</p>
        <p className="text-muted-foreground text-xs">
          Expires {expiresAt ? new Date(expiresAt).toLocaleString() : "Unknown"}
        </p>
      </div>

      <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
        {({ allowed }) => (
          <Button
            disabled={!allowed}
            onClick={async () => {
              const tx = invitationsCollection.delete(id);
              try {
                await tx.isPersisted.promise;
                trackEvent("org_invitation_revoked", { success: true });
                toastManager.add({
                  title: "Invitation revoked",
                  type: "success",
                });
              } catch {
                trackEvent("org_invitation_revoked", { success: false });
                toastManager.add({
                  title: "Failed to revoke invitation",
                  type: "error",
                });
              }
            }}
            size="icon-sm"
            type="button"
            variant="destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        )}
      </PolicyGuard>
    </div>
  );
}

function InvitationListItemLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <SkeletonWrapper>
          <p className="text-sm font-medium">invite@example.com</p>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <p className="text-muted-foreground text-xs">Invited as manager</p>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <p className="text-muted-foreground text-xs">Expires soon</p>
        </SkeletonWrapper>
      </div>

      <SkeletonWrapper>
        <Button size="icon-sm" type="button" variant="destructive">
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </SkeletonWrapper>
    </div>
  );
}

const memberLoadingIds = ["member-loading-1", "member-loading-2"];
const invitationLoadingIds = ["invitation-loading-1", "invitation-loading-2"];

const InviteMemberFormSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum([...INVITABLE_ROLES]),
});

function InviteMemberForm() {
  const organizationId = useOrganizationId();
  const { atLimit, limit } = usePrivilegedMemberLimit();

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const form = useAppForm({
    defaultValues: {
      email: "",
      role: "manager" as InvitableRole,
    },
    validators: {
      onSubmit: InviteMemberFormSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      const result = await authClient.organization.inviteMember({
        email: value.email.trim().toLowerCase(),
        organizationId,
        role: value.role,
      });

      if (result.error) {
        trackEvent("org_member_invited", {
          role: value.role,
          success: false,
        });
        toastManager.add({
          title: "Failed to invite member",
          type: "error",
        });
        return;
      }

      await Promise.all([
        membersCollection.utils.refetch(),
        invitationsCollection.utils.refetch(),
      ]);
      trackEvent("org_member_invited", { role: value.role, success: true });
      toastManager.add({
        title: "Invitation sent",
        type: "success",
      });
      formApi.reset();
    },
  });

  return (
    <form
      className="grid grid-cols-[1fr_180px_auto] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppField name="email">
        {(field) => (
          <SkeletonWrapper>
            <field.TextField
              hideLabel
              label="Invite email"
              placeholder="teammate@company.com"
              type="email"
            />
          </SkeletonWrapper>
        )}
      </form.AppField>

      <div className="flex items-center gap-2">
        {/* SAFETY: The runtime invariant checked by the surrounding code
        guarantees this type. */}
        <form.AppField name="role">
          {(field) => (
            // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
            <Select
              onValueChange={(value) =>
                field.handleChange(value as InvitableRole)
              }
              value={field.state.value}
            >
              <SkeletonWrapper>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </SkeletonWrapper>
              <SelectPopup>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="contributor">Contributor</SelectItem>
                <SelectItem disabled={atLimit} value="admin">
                  Admin
                </SelectItem>
              </SelectPopup>
            </Select>
          )}
        </form.AppField>
        {atLimit ? (
          <SettingsItem.PaidPlanIndicator
            content={`Admin roles are limited to ${limit} on this plan. Upgrade to add more.`}
          />
        ) : null}
      </div>
      <form.AppForm>
        <SkeletonWrapper>
          <form.SubscribeButton type="submit">
            <HugeiconsIcon icon={Plus} />
            Invite
          </form.SubscribeButton>
        </SkeletonWrapper>
      </form.AppForm>
    </form>
  );
}
