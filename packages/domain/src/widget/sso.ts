import { currentDb, schema, transaction } from "@feeblo/db";
import {
  CompanyAttributeDefinitionId,
  ContactAttributeDefinitionId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
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
import { JwtSecretRepository } from "../jwt-secret/repository";
import { verifyJwt } from "../jwt-secret/verification";
import { UserRepository } from "../user/repository";

/**
 * Tagged error raised by the SSO programs. The `code` is mapped back to a
 * better-auth `APIError` by the jwt-auto-login plugin, keeping all error-code
 * knowledge inside the plugin.
 */
export class SsoError extends S.TaggedErrorClass<SsoError>()("SsoError", {
  code: S.Literals([
    "ORGANIZATION_HAS_NO_JWT_SECRET",
    "INVALID_JWT",
    "SSO_TOKEN_MISSING_EMAIL_OR_NAME",
    "FAILED_TO_CREATE_SSO_USER",
    "FAILED_TO_CREATE_SSO_CONTACT",
  ]),
  message: S.optional(S.String),
}) {}

export type SsoErrorCode = S.Schema.Type<(typeof SsoError)["fields"]["code"]>;

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
 * Verifies the organization JWT, parses the contact identity, upserts the
 * restricted widget user and linked contact. Returns the user id + display
 * name so the jwt-auto-login plugin can mint a better-auth session.
 *
 * Any failure is normalized to a {@link SsoError} so the plugin can map it to
 * the correct better-auth error code.
 */
export const createSsoSession = ({
  organizationId,
  token,
}: {
  organizationId: string;
  token: string;
}) =>
  Effect.gen(function* () {
    const jwtSecretRepository = yield* JwtSecretRepository;
    const attributeDefinitionRepository = yield* AttributeDefinitionRepository;
    const userRepository = yield* UserRepository;

    const secrets = yield* jwtSecretRepository.getSecretsForOrg({
      organizationId,
    });

    if (secrets.length === 0) {
      return yield* new SsoError({
        code: "ORGANIZATION_HAS_NO_JWT_SECRET",
      });
    }

    const jwtPayload = yield* verifyJwt(
      token,
      secrets.map((s) => s.secret)
    ).pipe(Effect.mapError(() => new SsoError({ code: "INVALID_JWT" })));

    const contactDefs =
      (yield* attributeDefinitionRepository.findContactAttributeDefinitions(
        organizationId
      )) as unknown as readonly TContactAttributeDefinition[];
    const companyDefs =
      (yield* attributeDefinitionRepository.findCompanyAttributeDefinitions(
        organizationId
      )) as unknown as readonly TCompanyAttributeDefinition[];

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

        yield* db
          .update(schema.contactTable)
          .set({ userId: newUserId, updatedAt: new Date() })
          .where(eq(schema.contactTable.userId, anonymousUserId));

        yield* db
          .update(schema.postTable)
          .set({ creatorId: newUserId, updatedAt: new Date() })
          .where(eq(schema.postTable.creatorId, anonymousUserId));
      })
    );
  });

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
  UserRepository.layer
);
