export type OrganizationPlan = "free" | "starter" | "professional";

export type PlanEntitlements = {
  boardLimit: number | null;
  privilegedRoleLimit: number | null;
  privateBoards: boolean;
};

export const PLAN_ENTITLEMENTS: Record<OrganizationPlan, PlanEntitlements> = {
  free: {
    boardLimit: 2,
    privilegedRoleLimit: 2,
    privateBoards: false,
  },
  starter: {
    boardLimit: 5,
    privilegedRoleLimit: 5,
    privateBoards: true,
  },
  professional: {
    boardLimit: null,
    privilegedRoleLimit: null,
    privateBoards: true,
  },
};

export const PRIVILEGED_MEMBER_ROLES = ["owner", "admin"] as const;

export const isPrivilegedMemberRole = (role: string) =>
  PRIVILEGED_MEMBER_ROLES.includes(
    role as (typeof PRIVILEGED_MEMBER_ROLES)[number]
  );
