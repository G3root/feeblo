import type { PublicApiScope } from "@feeblo/domain-contracts/public-api-scope";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ForbiddenScopeError } from "./errors";
import { requirePublicApiScope } from "./middleware";

/**
 * What an operation says about itself to a non-HTTP surface.
 *
 * The vocabulary is the MCP tool-annotation set — `readOnly`, `destructive`,
 * `idempotent`, `openWorld` — declared here rather than imported from
 * `effect/ai`, so this package does not depend on the AI surface for
 * HTTP to work. A projection reads them off the operation when it makes a tool.
 */
export type PublicApiOperationAnnotations = {
  /** The operation reads; it never changes stored state. */
  readonly readOnly: boolean;
  /**
   * The operation can destroy data or move it between records, so a client
   * should confirm before running it. A write a companion operation can undo
   * still sets this: the hint it becomes is "not purely additive", and a merge
   * archives a post and reassigns its comments and votes.
   */
  readonly destructive: boolean;
  /** Repeating the same call has the same effect as calling it once. */
  readonly idempotent: boolean;
  /** The operation reaches beyond the workspace's own stored records. */
  readonly openWorld: boolean;
};

const DEFAULT_ANNOTATIONS: PublicApiOperationAnnotations = {
  destructive: false,
  idempotent: false,
  openWorld: false,
  readOnly: false,
};

/**
 * One Public API operation, independent of the surface that serves it.
 *
 * This is the unit a surface projects, not an HTTP endpoint: the schemas are
 * typed values rather than query strings, the handler returns the published DTO
 * rather than an `HttpServerResponse`, and nothing here names a method, a path,
 * or a status code. The HTTP projection in this package derives endpoints from
 * the same declarations, and the MCP projection (`mcp.ts`) derives tools from
 * them without restating a single branch of the handler.
 *
 * The scope is a field *and* is enforced by the handler: `defineOperation`
 * wraps the implementation in `requirePublicApiScope`, so a surface that
 * forgets to check cannot exist, and the metadata is there for the surface to
 * describe the requirement.
 */
export type PublicApiOperation<
  Name extends string,
  Input extends Schema.Top,
  Output extends Schema.Top,
  Failure extends Schema.Top,
  Requirements = never,
> = {
  readonly name: Name;
  readonly description: string;
  readonly scope: PublicApiScope;
  readonly input: Input;
  readonly output: Output;
  readonly failure: Failure;
  readonly annotations: PublicApiOperationAnnotations;
  readonly handler: (
    input: Input["Type"]
  ) => Effect.Effect<Output["Type"], Failure["Type"], Requirements>;
};

/**
 * An operation whose schema and requirement types have been erased.
 *
 * A registry holds operations of many different shapes; this is the shape a
 * projection can iterate without naming each one. Callers that need the precise
 * channels recover them from the tuple, the way `public-api/operations.ts`
 * does.
 */
export type AnyPublicApiOperation = PublicApiOperation<
  string,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  unknown
>;

export interface DefineOperationOptions<
  Input extends Schema.Top,
  Output extends Schema.Top,
  Failure extends Schema.Top,
> {
  readonly description: string;
  readonly scope: PublicApiScope;
  readonly input: Input;
  readonly output: Output;
  /**
   * The operation's own failures. `FORBIDDEN_SCOPE` is added by
   * `defineOperation`, so a scope refusal is part of every operation's
   * published failure vocabulary rather than something a caller discovers.
   */
  readonly failure: Failure;
  readonly annotations?: Partial<PublicApiOperationAnnotations>;
}

/**
 * Declares and implements one operation.
 *
 * The returned record is frozen in every dimension that a surface could
 * otherwise get wrong: its scope check already runs, its failure vocabulary
 * already includes `FORBIDDEN_SCOPE`, and its handler's declared failure type
 * is checked against the schema it publishes.
 */
export const defineOperation = <
  const Name extends string,
  Input extends Schema.Top,
  Output extends Schema.Top,
  Failure extends Schema.Top,
  Requirements = never,
>(
  name: Name,
  options: DefineOperationOptions<Input, Output, Failure>,
  handler: (input: Input["Type"]) => Effect.Effect<
    Output["Type"],
    // The scope check runs before every operation, so an operation may fail
    // `FORBIDDEN_SCOPE` without restating it in its own failure schema; the
    // returned record publishes the union either way.
    Failure["Type"] | ForbiddenScopeError,
    Requirements
  >
): PublicApiOperation<
  Name,
  Input,
  Output,
  Schema.Union<readonly [Failure, typeof ForbiddenScopeError]>,
  Requirements
> => {
  const failure = Schema.Union([options.failure, ForbiddenScopeError]);

  return {
    annotations: { ...DEFAULT_ANNOTATIONS, ...options.annotations },
    description: options.description,
    failure,
    input: options.input,
    name,
    output: options.output,
    scope: options.scope,
    handler: (input) =>
      requirePublicApiScope(options.scope).pipe(Effect.andThen(handler(input))),
  };
};
