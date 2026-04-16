import { HttpApi } from "@effect/platform";
import { AuthApiGroup } from "../auth/api-contract";
import { MediaApiGroup } from "../media/api-contract";
import { OrganizationApiGroup } from "../organization/api-contract";
import { ProfileApiGroup } from "../profile/api-contract";

export class Api extends HttpApi.make("Api")
  .add(AuthApiGroup)
  .add(MediaApiGroup)
  .add(OrganizationApiGroup)
  .add(ProfileApiGroup)
  .prefix("/api") {}
