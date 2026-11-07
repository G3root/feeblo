import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { InternalServerError } from "../../rpc-errors";
import type * as S from "./schema";

/** Provider-neutral persistence capability for external resources and their Feeblo-post links. */
export interface ExternalResourceServiceContract {
  /**
   * Ends the claim named by `claimGeneration`, returning whether this claim
   * still owned the row. `false` means the lease expired and another caller
   * took the reservation over; the row belongs to that claim now.
   */
  readonly completeCreation: (
    input: S.ExternalResourceCreationCompletion
  ) => Effect.Effect<boolean, InternalServerError>;
  /** The `failed` ending: the same fence, and the same meaning of `false`. */
  readonly failCreation: (
    input: S.ExternalResourceCreationFailure
  ) => Effect.Effect<boolean, InternalServerError>;
  readonly listPostLinks: (
    input: S.PostExternalResourceLinkList
  ) => Effect.Effect<
    readonly S.PostExternalResourceLink[],
    InternalServerError
  >;
  readonly recordPostLink: (
    input: S.RecordPostExternalResourceLink
  ) => Effect.Effect<S.RecordedPostExternalResourceLink, InternalServerError>;
  readonly reserveCreation: (
    input: S.ExternalResourceCreationReservation
  ) => Effect.Effect<
    S.ExternalResourceCreationReservationResult,
    InternalServerError
  >;
}

/** Service key for generic external-resource persistence. */
export class ExternalResourceService extends Context.Service<
  ExternalResourceService,
  ExternalResourceServiceContract
>()("@feeblo/ExternalResourceService") {}
