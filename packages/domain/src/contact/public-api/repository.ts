import { currentDb, schema } from "@feeblo/db";
import { ContactId } from "@feeblo/id";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { Cursor } from "../../public-api/cursor";
import {
  conflictError,
  invalidRequestError,
  internalError,
} from "../../public-api/errors";
import { withRemapDbErrors } from "../../rpc-errors";
import type { PublicApiEndUserSource } from "./mappers";

export type PublicApiEndUserPage = {
  readonly users: readonly PublicApiEndUserSource[];
  readonly nextCursor: Cursor | null;
};

type ContactRow = typeof schema.contactTable.$inferSelect;

/**
 * The end-user columns, and the only place a contact field is selected from.
 *
 * `email`, `phone`, and `userId` are deliberately absent: the email and phone
 * are personal data the published DTO does not carry, and `userId` is the
 * internal actor identifier the API never returns. Selecting the narrow set
 * here is what keeps a column added to `contact` from reaching a response
 * without being added on purpose.
 */
const END_USER_COLUMNS = {
  id: schema.contactTable.id,
  externalId: schema.contactTable.externalId,
  name: schema.contactTable.name,
  avatar: schema.contactTable.avatar,
  companyId: schema.contactTable.companyId,
  createdAt: schema.contactTable.createdAt,
  updatedAt: schema.contactTable.updatedAt,
} as const;

const toEndUserSource = (row: {
  id: string;
  externalId: string | null;
  name: string | null;
  avatar: string | null;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PublicApiEndUserSource => ({
  id: row.id,
  externalId: row.externalId,
  name: row.name,
  avatarUrl: row.avatar,
  companyId: row.companyId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * End-user reads and the upsert, as the Public API alone performs them.
 *
 * The reads are public-specific — the published projection is narrower than
 * the dashboard's contact row, and the list is cursor-paged while the
 * dashboard's people-picker is a ranked search — so they do not reuse
 * `ContactRepository`. The write is a real upsert with the semantics the
 * endpoint documents, rather than the dashboard's loose find-then-write:
 * identifiers that name two different people are a conflict here, not a
 * silent pick, because an integration's sync would otherwise merge two
 * customers and never know.
 */
const makePublicApiEndUserRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const findContact = (organizationId: string, where: SQL | undefined) =>
    db
      .select()
      .from(schema.contactTable)
      .where(and(eq(schema.contactTable.organizationId, organizationId), where))
      .limit(1)
      .pipe(
        Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
        withRemapDbErrors("PublicApiEndUser", "select")
      );

  const findContactByExternalId = (
    organizationId: string,
    externalId: string
  ) =>
    findContact(organizationId, eq(schema.contactTable.externalId, externalId));

  const findContactByEmail = (organizationId: string, email: string) =>
    findContact(
      organizationId,
      // Stored addresses may vary in case (widget/SSO input); match
      // case-insensitively so one human still resolves to one contact.
      sql`lower(${schema.contactTable.email}) = ${normalizeEmail(email)}`
    );

  return {
    /**
     * One page of the workspace's end users, newest first.
     *
     * Ordered and paged exactly like every other list in this API — the same
     * `(createdAt, id)` tuple and the same cursor — so a caller learns one
     * paging rule for the whole surface. Fetches `limit + 1` rows to learn
     * whether another page exists without a second query.
     */
    listEndUsers: ({
      companyId,
      cursor,
      email,
      externalId,
      limit,
      organizationId,
    }: {
      companyId: string | null;
      cursor: Cursor | null;
      email: string | null;
      externalId: string | null;
      limit: number;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const conditions: SQL[] = [
          eq(schema.contactTable.organizationId, organizationId),
        ];
        if (externalId !== null) {
          conditions.push(eq(schema.contactTable.externalId, externalId));
        }
        if (email !== null) {
          conditions.push(
            sql`lower(${schema.contactTable.email}) = ${normalizeEmail(email)}`
          );
        }
        if (companyId !== null) {
          conditions.push(eq(schema.contactTable.companyId, companyId));
        }
        if (cursor !== null) {
          conditions.push(
            sql`(${schema.contactTable.createdAt}, ${schema.contactTable.id}) < (${cursor.createdAt}, ${cursor.id})`
          );
        }

        const rows = yield* db
          .select(END_USER_COLUMNS)
          .from(schema.contactTable)
          .where(and(...conditions))
          .orderBy(
            desc(schema.contactTable.createdAt),
            desc(schema.contactTable.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows.at(-1);

        return {
          users: pageRows.map(toEndUserSource),
          nextCursor:
            hasMore && lastRow !== undefined
              ? { createdAt: lastRow.createdAt, id: lastRow.id }
              : null,
        } satisfies PublicApiEndUserPage;
      }).pipe(withRemapDbErrors("PublicApiEndUser", "select")),

    /** One end user by id, or `None` when the id is not this workspace's. */
    findEndUser: ({
      endUserId,
      organizationId,
    }: {
      endUserId: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(END_USER_COLUMNS)
          .from(schema.contactTable)
          .where(
            and(
              eq(schema.contactTable.id, endUserId),
              eq(schema.contactTable.organizationId, organizationId)
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0)).pipe(
          Option.map(toEndUserSource)
        );
      }).pipe(withRemapDbErrors("PublicApiEndUser", "select")),

    /**
     * Creates or updates one end user.
     *
     * `externalId` and `email` are the identity: the record is looked up by
     * whichever are present, and two that name different people are refused
     * rather than merged. An absent field is left alone and an explicit null
     * clears a nullable one, the same rule a post update follows.
     *
     * A create writes `source` as `API`, so a workspace can tell an
     * integration's records from its own, and leaves the linked account null:
     * a customer with no account is a customer, and the account is provisioned
     * by the first write that needs one (a comment or a vote).
     */
    upsertEndUser: ({
      avatarUrl,
      companyId,
      email,
      externalId,
      name,
      organizationId,
    }: {
      avatarUrl: string | null | undefined;
      companyId: string | null | undefined;
      email: string | null | undefined;
      externalId: string | null | undefined;
      name: string | null | undefined;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const wantedExternalId = externalId ?? null;
        const wantedEmail =
          email === null || email === undefined ? email : normalizeEmail(email);

        if (companyId !== undefined && companyId !== null) {
          const company = yield* db
            .select({ id: schema.companyTable.id })
            .from(schema.companyTable)
            .where(
              and(
                eq(schema.companyTable.id, companyId),
                eq(schema.companyTable.organizationId, organizationId)
              )
            )
            .limit(1);
          if (company.length === 0) {
            return yield* invalidRequestError(
              "companyId does not name a company in this workspace."
            );
          }
        }

        const byExternalId =
          wantedExternalId === null
            ? Option.none<ContactRow>()
            : yield* findContactByExternalId(organizationId, wantedExternalId);
        const byEmail =
          wantedEmail === null || wantedEmail === undefined
            ? Option.none<ContactRow>()
            : yield* findContactByEmail(organizationId, wantedEmail);

        // Two identifiers that name different records: the caller's own data
        // disagrees with itself, and picking one would merge two customers.
        if (
          Option.isSome(byExternalId) &&
          Option.isSome(byEmail) &&
          byExternalId.value.id !== byEmail.value.id
        ) {
          return yield* conflictError(
            "The external id and email belong to different end users."
          );
        }

        const existing = Option.isSome(byExternalId) ? byExternalId : byEmail;

        if (Option.isNone(existing)) {
          const id = yield* ContactId.generate;
          const now = yield* DateTime.nowAsDate;
          const [created = null] = yield* db
            .insert(schema.contactTable)
            .values({
              id,
              organizationId,
              externalId: wantedExternalId,
              email: wantedEmail ?? null,
              name: name ?? null,
              avatar: avatarUrl ?? null,
              companyId: companyId ?? null,
              source: "API",
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();

          if (created !== null) {
            return toEndUserSource(created);
          }

          // Lost a race against a concurrent create: the winner is readable
          // by one of the identifiers, or the request cannot be answered.
          const winner = yield* Effect.gen(function* () {
            if (wantedExternalId !== null) {
              const found = yield* findContactByExternalId(
                organizationId,
                wantedExternalId
              );
              if (Option.isSome(found)) {
                return found;
              }
            }
            if (wantedEmail !== null && wantedEmail !== undefined) {
              return yield* findContactByEmail(organizationId, wantedEmail);
            }
            return Option.none<ContactRow>();
          });

          return yield* Option.match(winner, {
            onNone: () =>
              Effect.fail(
                internalError(
                  "The end user could not be read after it was created."
                )
              ),
            onSome: (found) => Effect.succeed(toEndUserSource(found)),
          });
        }

        const now = yield* DateTime.nowAsDate;
        const [updated = null] = yield* db
          .update(schema.contactTable)
          .set({
            ...(externalId !== undefined && { externalId: wantedExternalId }),
            ...(email !== undefined && { email: wantedEmail ?? null }),
            ...(name !== undefined && { name }),
            ...(avatarUrl !== undefined && { avatar: avatarUrl }),
            ...(companyId !== undefined && { companyId }),
            updatedAt: now,
          })
          .where(eq(schema.contactTable.id, existing.value.id))
          .returning();

        if (updated === null) {
          return yield* internalError(
            "The end user could not be read after it was updated."
          );
        }
        return toEndUserSource(updated);
      }).pipe(withRemapDbErrors("PublicApiEndUser", "update")),
  };
});
export class PublicApiEndUserRepository extends Context.Service<PublicApiEndUserRepository>()(
  "PublicApiEndUserRepository",
  {
    make: makePublicApiEndUserRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through
 * the route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentPublicApiCaller`.
 */
export const currentPublicApiEndUserRepository = Effect.context<never>().pipe(
  Effect.map((context) =>
    Context.getUnsafe(context, PublicApiEndUserRepository)
  )
);
