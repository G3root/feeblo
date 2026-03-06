import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { MembershipServiceErrors } from "./errors";
import {
  CancelInvitation,
  InviteMember,
  Membership,
  OrganizationId,
  OrganizationInvitation,
  OrganizationMember,
  RemoveMember,
  UpdateMemberRole,
} from "./schema";

export class MembershipRpcs extends RpcGroup.make(
  Rpc.make("MembershipList", {
    success: Schema.Array(Membership),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationMembersList", {
    payload: OrganizationId,
    success: Schema.Array(OrganizationMember),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationInvitationsList", {
    payload: OrganizationId,
    success: Schema.Array(OrganizationInvitation),
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationInviteMember", {
    payload: InviteMember,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationUpdateMemberRole", {
    payload: UpdateMemberRole,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationRemoveMember", {
    payload: RemoveMember,
    success: Schema.Void,
    error: MembershipServiceErrors,
  }),
  Rpc.make("OrganizationCancelInvitation", {
    payload: CancelInvitation,
    success: Schema.Void,
    error: MembershipServiceErrors,
  })
).middleware(AuthMiddleware) {}
