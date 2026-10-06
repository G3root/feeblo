import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Reads a service from the fiber context without declaring it as a requirement.
 *
 * `HttpApiBuilder` and the RPC router do not thread a handler's service
 * requirements through the route layer, so the Public API's operations read
 * their collaborators from the context the composition provides. Erasing the
 * requirement channel keeps those handlers type-checking against the pieces
 * they actually declare; the composition root is what supplies the value, so a
 * missing layer is a request-time failure by design.
 */
export const currentService = <I, S>(tag: Context.Key<I, S>) =>
  Effect.context<never>().pipe(
    Effect.map((context) => Context.getUnsafe(context, tag))
  );
