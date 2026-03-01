import { HttpApi } from "@effect/platform";
import { AuthApiGroup } from "../auth/api-contract";

export class Api extends HttpApi.make("Api").add(AuthApiGroup).prefix("/api") {}
