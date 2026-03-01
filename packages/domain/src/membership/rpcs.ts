import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { MembershipServiceErrors } from "./errors";
import {
  CancelInvitationInput,
  InviteMemberInput,
  Membership,
  OrganizationIdInput,
  OrganizationInvitation,
  OrganizationMember,
  RemoveMemberInput,
  UpdateMemberRoleInput,
} from "./schema";

export class MembershipRpcs extends RpcGroup.make(
  Rpc.make("MembershipList", {
    success: Schema.Array(Membership),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationMembersList", {
    payload: OrganizationIdInput,
    success: Schema.Array(OrganizationMember),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationInvitationsList", {
    payload: OrganizationIdInput,
    success: Schema.Array(OrganizationInvitation),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationInviteMember", {
    payload: InviteMemberInput,
    success: OrganizationInvitation,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationUpdateMemberRole", {
    payload: UpdateMemberRoleInput,
    success: OrganizationMember,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationRemoveMember", {
    payload: RemoveMemberInput,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationCancelInvitation", {
    payload: CancelInvitationInput,
    success: Schema.Void,
    error: MembershipServiceErrors,
  })
).middleware(AuthMiddleware) {}
