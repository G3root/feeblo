import { Delete02Icon, Plus, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import { MembersSettingsLayout } from "~/features/settings/components/settings-members-layout";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { authClient } from "~/lib/auth-client";
import { invitationsCollection, membersCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

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
    <MembersSettingsLayout.Root
      description="Invite teammates, adjust roles, and maintain access controls."
      title="members"
    >
      <MembersSection />
      <InvitationsSection />
    </MembersSettingsLayout.Root>
  );
}

function MembersSection() {
  const organizationId = useOrganizationId();
  const { data: session } = authClient.useSession();
  const [search, setSearch] = React.useState("");

  const { data: allMembers } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
    [organizationId]
  );
  const membersSource = allMembers as OrganizationMemberRow[];

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

  return (
    <MembersSettingsLayout.Section title="Members">
      <MembersSettingsLayout.Controls>
        <InviteMemberForm />
        {isEmpty ? null : (
          <InputGroup>
            <InputGroupInput
              aria-label="Search members"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email..."
              type="search"
              value={search}
            />
            <InputGroupAddon align="inline-end">
              <HugeiconsIcon icon={Search01Icon} />
            </InputGroupAddon>
          </InputGroup>
        )}
      </MembersSettingsLayout.Controls>

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
              <div
                className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
                key={member.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {member.user?.name || "Unnamed user"}
                    {isCurrentUser ? " (You)" : ""}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {member.user?.email || "No email"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    onValueChange={async (value) => {
                      const tx = membersCollection.update(
                        member.id,
                        (draft) => {
                          draft.role = value as "owner" | "admin" | "member";
                        }
                      );
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
                      {isOwner ? (
                        <SelectItem value="owner">Owner</SelectItem>
                      ) : null}
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    disabled={isOwner}
                    onClick={async () => {
                      const tx = membersCollection.delete(member.id);
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
                </div>
              </div>
            );
          })}
        </MembersSettingsLayout.List>
      )}
    </MembersSettingsLayout.Section>
  );
}

function InvitationsSection() {
  const organizationId = useOrganizationId();
  const [search, setSearch] = React.useState("");

  const { data: allInvitations } = useLiveSuspenseQuery(
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
  const invitationsSource = allInvitations as OrganizationInvitationRow[];

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

  return (
    <MembersSettingsLayout.Section title="Invitations">
      {isEmpty ? null : (
        <InputGroup>
          <InputGroupInput
            aria-label="Search invitations"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by email..."
            type="search"
            value={search}
          />
          <InputGroupAddon align="inline-end">
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupAddon>
        </InputGroup>
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
            <div
              className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
              key={invitation.id}
            >
              <div className="space-y-1">
                <p className="font-medium text-sm">{invitation.email}</p>
                <p className="text-muted-foreground text-xs">
                  Invited as {invitation.role || "member"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Expires{" "}
                  {invitation.expiresAt
                    ? new Date(invitation.expiresAt).toLocaleString()
                    : "Unknown"}
                </p>
              </div>

              <Button
                onClick={async () => {
                  const tx = invitationsCollection.delete(invitation.id);
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
            </div>
          ))}
        </MembersSettingsLayout.List>
      )}
    </MembersSettingsLayout.Section>
  );
}

const InviteMemberFormSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["member", "admin"]),
});

function InviteMemberForm() {
  const organizationId = useOrganizationId();
  const form = useAppForm({
    defaultValues: {
      email: "",
      role: "member" as "member" | "admin",
    },
    validators: {
      onChange: InviteMemberFormSchema,
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
          <field.TextField
            hideLabel
            label="Invite email"
            placeholder="teammate@company.com"
            type="email"
          />
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
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        )}
        name="role"
      />
      <form.AppForm>
        <form.SubscribeButton label="Invite" type="submit">
          <HugeiconsIcon icon={Plus} />
          Invite
        </form.SubscribeButton>
      </form.AppForm>
    </form>
  );
}
