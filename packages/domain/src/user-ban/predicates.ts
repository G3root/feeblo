import { schema } from "@feeblo/db";
import { type AnyColumn, sql, type SQL } from "drizzle-orm";

/**
 * The author fields a ban is matched against.
 *
 * A ban names an account, an address, or both (`user_ban_subject_chk`), so a
 * read that wants to know whether an author is banned has to test both facets
 * exactly the way `UserBanRepository.isBanned` does.
 */
export type AuthorBanFacets = {
  /** The workspace the ban must belong to. */
  readonly organizationId: AnyColumn | SQL;
  /** The author's account id; null for a contact-only or anonymous author. */
  readonly userId: AnyColumn | SQL;
  /**
   * Every address the ban may name instead of the account: the author's own
   * account address, and on a dashboard read the linked contact's, because an
   * on-behalf post has no `creatorId` for a ban to match on.
   */
  readonly emails: readonly (AnyColumn | SQL)[];
};

/**
 * Builds the `exists` predicate answering "is this author banned here".
 *
 * The flag is derived in SQL rather than joined in the client for the same
 * reason `authorIsMember` is: the identifiers a client-side join would need are
 * redacted on public reads, and an address-only ban has no account id to join
 * on at all. The address comparison normalizes the candidate the way the ban
 * table stores it (`user_ban_email_normalized_chk` keeps every stored address
 * lowercased and trimmed), so a mixed-case account address still matches.
 *
 * Both facets are covered by partial unique indexes on
 * `(organization_id, user_id)` and `(organization_id, email)`, so this is an
 * index probe per row on the dashboard surfaces that ask for it. They are the
 * ones that pass `authorBan` to the post selectors and the dashboard comment
 * read; no public projection includes the flag.
 */
export const bannedAuthorPredicate = ({
  emails,
  organizationId,
  userId,
}: AuthorBanFacets): SQL<boolean> => sql`exists (
  select 1
  from ${schema.userBanTable} as author_ban
  where author_ban.organization_id = ${organizationId}
    and (
      (
        author_ban.user_id is not null
        and author_ban.user_id = ${userId}
      )
      or ${
        emails.length === 0
          ? sql`false`
          : sql.join(
              emails.map(
                (email) => sql`(
                  author_ban.email is not null
                  and author_ban.email = lower(btrim(${email}))
                )`
              ),
              sql` or `
            )
      }
    )
)`;
