import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { InternalServerError } from "../../rpc-errors";
import type * as S from "./schema";

/** Provider-neutral persistence capability for external resources and their Feeblo-post links. */
export interface ExternalResourceServiceShape {
  readonly completeCreation: (
    input: S.ExternalResourceCreationCompletion
  ) => Effect.Effect<void, InternalServerError>;
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
  ExternalResourceServiceShape
>()("@feeblo/ExternalResourceService") {}
