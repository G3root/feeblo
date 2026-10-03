import type * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";

/**
 * The HTTP implementation of one endpoint of a composed group, typed by the
 * endpoint's identifier.
 *
 * `HttpApiBuilder` does not expose a name for "the handler for endpoint X", so
 * a per-resource handler record annotates each entry with this helper. The
 * group — not the resource's own endpoint tuple — is the type it derives from,
 * because `HttpApiGroup.add` returns endpoints with the group's middleware
 * attached and `handleAll` checks the request's `endpoint` field exactly.
 *
 * Two things follow from it: the request the handler receives is the endpoint's
 * decoded request (params, query, payload), and the error channel is checked
 * against the endpoint's declared failures.
 */
export type HandlerOf<
  Group extends {
    readonly endpoints: Record<string, HttpApiEndpoint.Constraint>;
  },
  Identifier extends keyof Group["endpoints"],
  Requirements = never,
> = HttpApiEndpoint.Handler<
  Group["endpoints"][Identifier],
  HttpApiEndpoint.MiddlewareError<Group["endpoints"][Identifier]>,
  Requirements
>;
