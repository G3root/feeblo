import { currentDb, schema, transaction } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as S from "effect/Schema";

import { AttributeDefinitionRepository } from "../attribute-definition/repository";
import type {
  TCompanyAttributeDefinition,
  TContactAttributeDefinition,
} from "../attribute-definition/schema";
import { CompanyRepository } from "../company/repository";
import type { DataValidationError } from "../contact/errors";
import { ContactRepository } from "../contact/repository";
import type { ParsedPersonAttributes } from "../contact/utils";
import { parsePersonAttributes } from "../contact/utils";
import { EntitlementPolicy } from "../entitlement/policies";
import { JwtSecretRepository } from "../jwt-secret/repository";
import {
  maxTokenLifetimeFromMinutes,
  verifyJwt,
} from "../jwt-secret/verification";
import { OrganizationRepository } from "../organization/repository";
import { PolicyDeniedError } from "../policy";
import { RateLimitService } from "../rate-limit/service";
import { UserRepository } from "../user/repository";

/**
 * Tagged error raised by the SSO programs. The `code` is mapped back to a
 * better-auth `APIError` by the jwt-auto-login plugin, keeping all error-code
 * knowledge inside the plugin.
 */
export class SsoError extends S.TaggedError<SsoError>()("SsoError", {
  code: S.Literals([
    "ORGANIZATION_HAS_NO_JWT_SECRET",
    "INVALID_JWT",
    "SSO_TOKEN_MISSING_EMAIL_OR_NAME",
    "FAILED_TO_CREATE_SSO_USER",
    "FAILED_TO_CREATE_SSO_CONTACT",
    "WIDGET_SSO_NOT_ENTITLED",
    "SSO_RATE_LIMITED",
    "SSO_RATE_LIMIT_UNAVAILABLE",
  ]),
  message: S.optional(S.String),
}) {}

export type SsoErrorCode = S.Schema.Type<(typeof SsoError)["fields"]["code"]>;

/**
 * Tagged error raised when anonymous-account linking cannot be proven safe.
 * The caller (better-auth jwt-auto-login plugin) logs and skips the anonymous
 * user cleanup on failure, so the widget user's data is preserved for a later
 * retry instead of being orphaned or misattributed.
 */
export class LinkAnonymousAccountError extends S.TaggedError<LinkAnonymousAccountError>()(
  "LinkAnonymousAccountError",
  {
    code: S.Literals([
      "ANONYMOUS_USER_NOT_FOUND",
      "ANONYMOUS_USER_NOT_RESTRICTED",
      "NEW_USER_NOT_FOUND",
      "NEW_USER_IS_ANONYMOUS",
      "LINK_FAILED",
    ]),
    message: S.optional(S.String),
  }
) {}

export type LinkAnonymousAccountErrorCode = S.Schema.Type<
  (typeof LinkAnonymousAccountError)["fields"]["code"]
>;

export interface SsoSessionResult {
  email: string;
  name: string;
  userId: string;
}

/**
 * Upserts a contact (and its nested companies + custom attributes) from a
 * parsed JWT payload. When `userId` is provided the contact is linked to that
 * user so feedback created from the widget portal is owned by the SSO user.
 */
export function upsertContactFromParsed(
  organizationId: string,
  parsedContact: ParsedPersonAttributes,
  userId?: string
) {
  return Effect.gen(function* () {
    const workspaceId = yield* WorkspaceId.parse(organizationId);
    const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
    const contactRepository = yield* ContactRepository;
    const companyRepository = yield* CompanyRepository;
    let linkedCompanyId: string | undefined;

    for (const company of parsedContact.companies) {
      const upsertedCompany = yield* companyRepository.upsertCompany({
        organizationId,
        externalId: company.commonFields.id,
        name: company.commonFields.name,
        avatar: company.commonFields.avatar,
        externalCreatedAt: company.commonFields.externalCreatedAt,
      });
      linkedCompanyId = upsertedCompany.id;

      for (const attr of company.customAttributes) {
        const attributeId = yield* CompanyAttributeDefinitionId.parse(
          attr.definitionId
        );
        yield* attributeDefinitionRepository.upsertCompanyAttributeValue({
          companyId: upsertedCompany.id,
          attributeId,
          organizationId: workspaceId,
          value: attr.value,
        });
      }
    }

    const contactOption = yield* contactRepository.upsertContact({
      organizationId,
      externalId: parsedContact.commonFields.userId,
      email: parsedContact.commonFields.email,
      name: parsedContact.commonFields.name,
      avatar: parsedContact.commonFields.avatar,
      companyId: linkedCompanyId ?? null,
      userId: userId ?? null,
    });

    let contactId: string | undefined;
    if (Option.isSome(contactOption)) {
      contactId = contactOption.value.id;

      for (const attr of parsedContact.customAttributes) {
        const attributeId = yield* ContactAttributeDefinitionId.parse(
          attr.definitionId
        );
        yield* attributeDefinitionRepository.upsertContactAttributeValue({
          contactId: contactOption.value.id,
          attributeId,
          organizationId: workspaceId,
          value: attr.value,
        });
      }
    }

    return contactId;
  });
}

/**
 * Per-organization bound on verified widget SSO sign-ins. It is consumed only
 * after the JWT proves the caller holds this organization's secret, so an
 * unauthenticated request cannot lock out the organization's users.
 */
export const WIDGET_SSO_SIGN_IN_RATE_LIMIT = {
  keyPrefix: "widget-sso-sign-in",
  limit: 30,
  window: "1 minute",
} as const;

/** Per-client bound for unverified widget SSO attempts. */
export const WIDGET_SSO_ATTEMPT_RATE_LIMIT = {
  keyPrefix: "widget-sso-attempt",
  limit: 10,
  window: "1 minute",
} as const;

/**
 * Verifies the organization JWT, parses the contact identity, upserts the
 * restricted widget user and linked contact. Returns the user id + display
 * name so the jwt-auto-login plugin can mint a better-auth session.
 *
 * Any failure is normalized to a {@link SsoError} so the plugin can map it to
 * the correct better-auth error code.
 */
export const createSsoSession = ({
  clientIp,
  organizationId,
  token,
}: {
  clientIp: string;
  organizationId: string;
  token: string;
}) =>
  Effect.gen(function* () {
    const entitlementPolicy = yield* EntitlementPolicy;
    const jwtSecretRepository = yield* JwtSecretRepository;
    const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
    const userRepository = yield* UserRepository;

    // Reject a flood of unauthenticated JWT guesses before any organization
    // lookup or signature verification. The server supplies this peer-anchored
    // identity and overwrites any value sent by the client.
    yield* RateLimitService.use((rateLimiter) =>
      rateLimiter
        .consume({
          key: `${WIDGET_SSO_ATTEMPT_RATE_LIMIT.keyPrefix}:${clientIp}`,
          limit: WIDGET_SSO_ATTEMPT_RATE_LIMIT.limit,
          window: WIDGET_SSO_ATTEMPT_RATE_LIMIT.window,
        })
        .pipe(
          Effect.mapError((error) =>
            error.reason._tag === "RateLimitExceeded"
              ? new SsoError({ code: "SSO_RATE_LIMITED" })
              : new SsoError({ code: "SSO_RATE_LIMIT_UNAVAILABLE" })
          )
        )
    );

    yield* entitlementPolicy
      .canUseWidgetSso(organizationId)
      .pipe(
        Effect.mapError((error) =>
          error instanceof PolicyDeniedError
            ? new SsoError({ code: "WIDGET_SSO_NOT_ENTITLED" })
            : error
        )
      );

    const secrets = yield* jwtSecretRepository.getSecretsForOrg({
      organizationId,
    });

    if (secrets.length === 0) {
      return yield* new SsoError({
        code: "ORGANIZATION_HAS_NO_JWT_SECRET",
      });
    }

    // Per-workspace lifetime cap: `organization.jwt_max_token_lifetime_minutes`
    // tightens (never loosens) the 24h default so a workspace can shorten how
    // long a leaked token stays replayable. Invalid stored values fall back to
    // the default. A missing org row (impossible via
    // the FK) falls back to the default; other failures are normalized by the
    // outer catch below.
    const organizationRepository = yield* OrganizationRepository;
    const maxTokenLifetimeMinutes =
      yield* organizationRepository.findJwtMaxTokenLifetimeMinutes({
        organizationId,
      });
    const maxTokenLifetime = maxTokenLifetimeFromMinutes(
      maxTokenLifetimeMinutes
    );

    const jwtPayload = yield* verifyJwt(
      token,
      secrets.map((s) => s.secret),
      organizationId,
      { maxTokenLifetime }
    ).pipe(Effect.mapError(() => new SsoError({ code: "INVALID_JWT" })));

    // Bound contact and user provisioning only after a JWT has proved that
    // this request is authorized for the organization.
    yield* RateLimitService.use((rateLimiter) =>
      rateLimiter
        .consume({
          key: `${WIDGET_SSO_SIGN_IN_RATE_LIMIT.keyPrefix}:${organizationId}`,
          limit: WIDGET_SSO_SIGN_IN_RATE_LIMIT.limit,
          window: WIDGET_SSO_SIGN_IN_RATE_LIMIT.window,
        })
        .pipe(
          Effect.mapError((error) =>
            error.reason._tag === "RateLimitExceeded"
              ? new SsoError({ code: "SSO_RATE_LIMITED" })
              : new SsoError({ code: "SSO_RATE_LIMIT_UNAVAILABLE" })
          )
        )
    );

    const contactDefs =
      // SAFETY: the repository contract returns contact attribute definitions
      // in the canonical domain shape; the cast bridges the DB-row encoding.
      (yield* attributeDefinitionRepository.findContactAttributeDefinitions(
        organizationId
      )) as readonly TContactAttributeDefinition[];
    const companyDefs =
      // SAFETY: the repository contract returns company attribute definitions
      // in the canonical domain shape; the cast bridges the DB-row encoding.
      (yield* attributeDefinitionRepository.findCompanyAttributeDefinitions(
        organizationId
      )) as readonly TCompanyAttributeDefinition[];

    const parsedContact = yield* parsePersonAttributes(
      jwtPayload,
      contactDefs,
      companyDefs
    ).pipe(
      Effect.mapError(
        (error: DataValidationError) =>
          new SsoError({
            code: "SSO_TOKEN_MISSING_EMAIL_OR_NAME",
            message: error.message,
          })
      )
    );

    const { email, name } = parsedContact.commonFields;

    if (!(email && name)) {
      return yield* new SsoError({
        code: "SSO_TOKEN_MISSING_EMAIL_OR_NAME",
      });
    }

    const user = yield* userRepository
      .upsertSsoUser({
        email,
        name,
        restrictedToOrganizationId: organizationId,
      })
      .pipe(
        Effect.mapError(
          () => new SsoError({ code: "FAILED_TO_CREATE_SSO_USER" })
        )
      );

    const contactId = yield* transaction(
      upsertContactFromParsed(organizationId, parsedContact, user.id)
    ).pipe(
      Effect.mapError(
        () => new SsoError({ code: "FAILED_TO_CREATE_SSO_CONTACT" })
      )
    );

    if (!contactId) {
      return yield* new SsoError({
        code: "FAILED_TO_CREATE_SSO_CONTACT",
      });
    }

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
    };
  }).pipe(
    // Normalize any remaining (unexpected) failures into a generic SSO error
    // so the plugin always receives a SsoError.
    Effect.catch((error) =>
      error instanceof SsoError
        ? Effect.fail(error)
        : Effect.fail(new SsoError({ code: "FAILED_TO_CREATE_SSO_USER" }))
    )
  );

/**
 * Re-assigns widget portal data (contacts and authored posts) from the
 * restricted SSO user to the real user created during a global sign-in. Runs
 * before the restricted user is deleted so contact ownership survives the
 * cascade (`contact.userId` is `ON DELETE SET NULL`).
 *
 * The function is defense-in-depth hardened against misuse: it must never
 * reassign another user's data, so both ids are verified against the user
 * table before any row is touched. The anonymous side must be a restricted
 * SSO user (widget portal identity) and the target must be a real account —
 * linking two anonymous accounts or claiming a non-restricted user's data is
 * rejected. No same-organization membership is required: a widget user may
 * legitimately sign in globally before joining the workspace, and the
 * restricted flag is the invariant that proves portal identity.
 *
 * Failures are reported via {@link LinkAnonymousAccountError} (no partial
 * transfer); the caller logs and skips the anonymous user cleanup so the data
 * is preserved for a later retry.
 */
export const linkAnonymousAccount = ({
  anonymousUserId,
  newUserId,
}: {
  anonymousUserId: string;
  newUserId: string;
}) =>
  Effect.gen(function* () {
    if (anonymousUserId === newUserId) {
      return;
    }

    yield* transaction(
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;

        const [anonymousUser, newUser] = yield* Effect.all([
          db
            .select({
              restrictedToOrganizationId:
                schema.userTable.restrictedToOrganizationId,
            })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, anonymousUserId))
            .limit(1),
          db
            .select({
              restrictedToOrganizationId:
                schema.userTable.restrictedToOrganizationId,
            })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, newUserId))
            .limit(1),
        ]);
        const anonymous = anonymousUser[0];
        const target = newUser[0];

        if (!anonymous) {
          return yield* new LinkAnonymousAccountError({
            code: "ANONYMOUS_USER_NOT_FOUND",
          });
        }
        if (!anonymous.restrictedToOrganizationId) {
          return yield* new LinkAnonymousAccountError({
            code: "ANONYMOUS_USER_NOT_RESTRICTED",
          });
        }
        if (!target) {
          return yield* new LinkAnonymousAccountError({
            code: "NEW_USER_NOT_FOUND",
          });
        }
        if (target.restrictedToOrganizationId) {
          return yield* new LinkAnonymousAccountError({
            code: "NEW_USER_IS_ANONYMOUS",
          });
        }

        yield* db
          .update(schema.contactTable)
          .set({ userId: newUserId, updatedAt: now })
          .where(eq(schema.contactTable.userId, anonymousUserId));

        yield* db
          .update(schema.postTable)
          .set({ creatorId: newUserId, updatedAt: now })
          .where(eq(schema.postTable.creatorId, anonymousUserId));
      })
    );
  }).pipe(
    // Normalize transport failures (unexpected database/SQL errors) into the
    // typed error while preserving link-specific rejections byte-for-byte, so
    // the caller sees a single error channel it can log and retry safely.
    Effect.catch((error) =>
      error instanceof LinkAnonymousAccountError
        ? Effect.fail(error)
        : Effect.fail(
            new LinkAnonymousAccountError({
              code: "LINK_FAILED",
              message:
                "Failed to transfer widget portal data to the real account",
            })
          )
    )
  );

/**
 * Convenience layer bundling the repositories the SSO programs need. Compose
 * this on top of a {@link Database} layer when running the programs from a
 * non-Effect runtime (e.g. the better-auth plugin).
 */
export const SsoRepositoriesLive = Layer.mergeAll(
  AttributeDefinitionRepository.layer,
  CompanyRepository.layer,
  ContactRepository.layer,
  JwtSecretRepository.layer,
  OrganizationRepository.layer,
  UserRepository.layer
);
