import { HttpApi } from "@effect/platform";
import { AuthApiGroup } from "../auth/api-contract";
import { ProfileApiGroup } from "../profile/api-contract";

export class Api extends HttpApi.make("Api")
  .add(AuthApiGroup)
  .add(ProfileApiGroup)
  .prefix("/api") {}
