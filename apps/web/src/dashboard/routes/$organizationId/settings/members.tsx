import { Delete02Icon, Plus, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@feeblo/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { toastManager } from "@feeblo/ui/toast";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { MembersSettingsLayout } from "~/features/settings/components/settings-members-layout";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasOwnerOrAdminRole, PolicyGuard } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute("/$organizationId/settings/members")({
  component: MembersSettingsPage,
});

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

function MembersSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Members</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Invite teammates, adjust roles, and maintain access controls.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <MembersSection />
        <InvitationsSection />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

function MembersSection() {
  const organizationId = useOrganizationId();
  const { membersCollection } = useDashboardCollections();
  const { data: session } = authClient.useSession();
  const [search, setSearch] = React.useState("");

  const membersQuery = useLiveQuery(
    (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
    [organizationId]
  );
  const membersSource = (membersQuery.data ?? []) as OrganizationMemberRow[];

  const members = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return membersSource;
    }

    return membersSource.filter((member) => {
      const name = member.user?.name?.toLowerCase() ?? "";
      const email = member.user?.email?.toLowerCase() ?? "";
      return name.includes(term) || email.includes(term);
    });
  }, [membersSource, search]);

  const noFilter = members.length === 0 && search.trim() !== "";
  const isEmpty = membersSource.length === 0;

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
            const role = member.role.split(",")[0] as
              | "owner"
              | "admin"
              | "member";
            const isOwner = member.role.split(",").includes("owner");
            const isCurrentUser = member.userId === session?.user?.id;

            return (
              <MemberListItem
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

function InvitationsSection() {
  const organizationId = useOrganizationId();
  const { invitationsCollection } = useDashboardCollections();
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
  );
  const invitationsSource = (invitationsQuery.data ??
    []) as OrganizationInvitationRow[];

  const invitations = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return invitationsSource;
    }

    return invitationsSource.filter((invitation) =>
      invitation.email.toLowerCase().includes(term)
    );
  }, [invitationsSource, search]);

  const noFilter = invitations.length === 0 && search.trim() !== "";
  const isEmpty = invitationsSource.length === 0;

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
              role={invitation.role || "member"}
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
  email,
  id,
  isCurrentUser,
  isOwner,
  name,
  organizationId,
  role,
}: {
  email: string;
  id: string;
  isCurrentUser: boolean;
  isOwner: boolean;
  name: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
}) {
  const { membersCollection } = useDashboardCollections();

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">
          {name}
          {isCurrentUser ? " (You)" : ""}
        </p>
        <p className="truncate text-muted-foreground text-xs">{email}</p>
      </div>

      <div className="flex items-center gap-2">
        <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
          <Select
            onValueChange={async (value) => {
              const tx = membersCollection.update(id, (draft) => {
                draft.role = value as "owner" | "admin" | "member";
              });
              try {
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Member role updated",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to update role",
                  type: "error",
                });
              }
            }}
            value={role}
          >
            <SelectTrigger className="w-28" disabled={isOwner}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isOwner ? <SelectItem value="owner">Owner</SelectItem> : null}
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>

          <Button
            disabled={isOwner}
            onClick={async () => {
              const tx = membersCollection.delete(id);
              try {
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Member removed",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to remove member",
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
          <p className="truncate font-medium text-sm">Loading member</p>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <p className="truncate text-muted-foreground text-xs">
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
  const { invitationsCollection } = useDashboardCollections();

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="font-medium text-sm">{email}</p>
        <p className="text-muted-foreground text-xs">Invited as {role}</p>
        <p className="text-muted-foreground text-xs">
          Expires {expiresAt ? new Date(expiresAt).toLocaleString() : "Unknown"}
        </p>
      </div>

      <PolicyGuard policy={hasOwnerOrAdminRole(organizationId)}>
        <Button
          onClick={async () => {
            const tx = invitationsCollection.delete(id);
            try {
              await tx.isPersisted.promise;
              toastManager.add({
                title: "Invitation revoked",
                type: "success",
              });
            } catch (_error) {
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
      </PolicyGuard>
    </div>
  );
}

function InvitationListItemLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <SkeletonWrapper>
          <p className="font-medium text-sm">invite@example.com</p>
        </SkeletonWrapper>
        <SkeletonWrapper>
          <p className="text-muted-foreground text-xs">Invited as member</p>
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
  role: z.enum(["member", "admin"]),
});

function InviteMemberForm() {
  const organizationId = useOrganizationId();
  const { invitationsCollection, membersCollection } =
    useDashboardCollections();
  const form = useAppForm({
    defaultValues: {
      email: "",
      role: "member" as "member" | "admin",
    },
    validators: {
      onSubmit: InviteMemberFormSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await fetchRpc((rpc) =>
          rpc.OrganizationInviteMember({
            email: value.email.trim().toLowerCase(),
            organizationId,
            role: value.role,
          })
        );
      } catch (_error) {
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
      toastManager.add({
        title: "Invitation sent",
        type: "success",
      });
      formApi.reset();
    },
  });

  return (
    <form
      className="grid grid-cols-[1fr_130px_auto] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppField
        children={(field) => (
          <SkeletonWrapper>
            <field.TextField
              hideLabel
              label="Invite email"
              placeholder="teammate@company.com"
              type="email"
            />
          </SkeletonWrapper>
        )}
        name="email"
      />

      <form.AppField
        children={(field) => (
          <Select
            onValueChange={(value) =>
              field.handleChange(value as "member" | "admin")
            }
            value={field.state.value}
          >
            <SkeletonWrapper>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </SkeletonWrapper>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        )}
        name="role"
      />
      <form.AppForm>
        <SkeletonWrapper>
          <form.SubscribeButton label="Invite" type="submit">
            <HugeiconsIcon icon={Plus} />
            Invite
          </form.SubscribeButton>
        </SkeletonWrapper>
      </form.AppForm>
    </form>
  );
}
