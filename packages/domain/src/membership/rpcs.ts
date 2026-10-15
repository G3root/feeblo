import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { MembershipServiceErrors } from "./errors";
import {
  CancelInvitation,
  Membership,
  OrganizationId,
  OrganizationInvitation,
  OrganizationMember,
  RemoveMember,
  UpdateMemberRole,
} from "./schema";

export class MembershipRpcs extends RpcGroup.make(
  Rpc.make("ListMemberships", {
    success: Schema.Array(Membership),
    error: MembershipServiceErrors,
  }),
  Rpc.make("ListOrganizationMembers", {
    payload: OrganizationId,
    success: Schema.Array(OrganizationMember),
    error: MembershipServiceErrors,
  }),
  Rpc.make("ListOrganizationInvitations", {
    payload: OrganizationId,
    success: Schema.Array(OrganizationInvitation),
    error: MembershipServiceErrors,
  }),
  Rpc.make("UpdateOrganizationMemberRole", {
    payload: UpdateMemberRole,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("RemoveOrganizationMember", {
    payload: RemoveMember,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("CancelOrganizationInvitation", {
    payload: CancelInvitation,
    success: Schema.Void,
    error: MembershipServiceErrors,
  })
).middleware(AuthMiddleware) {}
