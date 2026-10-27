import * as HttpApi from "effect/http-api/HttpApi";

import { AuthApiGroup } from "../auth/api-contract";
import { DataTransferApiGroup } from "../data-transfer/api-contract";
import { EmailSubscriptionApiGroup } from "../email-subscription/api-contract";
import { MediaApiGroup } from "../media/api-contract";
import { NotificationPreferenceApiGroup } from "../notification-preference/api-contract";
import { OrganizationApiGroup } from "../organization/api-contract";
import { PricingApiGroup } from "../pricing/api-contract";
import { ProfileApiGroup } from "../profile/api-contract";

export class Api extends HttpApi.make("Api")
  .add(AuthApiGroup)
  .add(DataTransferApiGroup)
  .add(EmailSubscriptionApiGroup)
  .add(MediaApiGroup)
  .add(NotificationPreferenceApiGroup)
  .add(OrganizationApiGroup)
  .add(PricingApiGroup)
  .add(ProfileApiGroup)
  .prefix("/api") {}
