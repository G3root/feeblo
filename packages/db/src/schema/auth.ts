import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userTable = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    role: text("role"),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    twoFactorEnabled: boolean("two_factor_enabled").default(false),
    lastLoginMethod: text("last_login_method"),
    ssoLoginAt: timestamp("sso_login_at", { withTimezone: true }),
    emailHash: text("email_hash"),
  },
  (table) => [index("user_emailHash_idx").on(table.emailHash)]
);

export const sessionTable = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const accountTable = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verificationTable = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const twoFactorTable = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("twoFactor_secret_idx").on(table.secret),
    index("twoFactor_userId_idx").on(table.userId),
  ]
);

export const organizationTable = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    metadata: text("metadata"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)]
);

export const memberTable = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    role: text("role")
      .default("member")
      .$type<"member" | "owner" | "admin">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
    uniqueIndex("member_organizationId_userId_uidx").on(
      table.organizationId,
      table.userId
    ),
  ]
);

export const invitationTable = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

export const subscriptionTable = pgTable("subscription", {
  id: text("id").primaryKey(),
  externalId: text("external_id").unique().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationTable.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull(),
  currency: text("currency").notNull(),
  recurringInterval: text("recurring_interval").notNull(),
  recurringIntervalCount: integer("recurring_interval_count").notNull(),
  status: text("status")
    .$type<
      | "incomplete"
      | "incomplete_expired"
      | "trialing"
      | "active"
      | "past_due"
      | "canceled"
      | "unpaid"
    >()
    .notNull(),

  currentPeriodStart: timestamp("current_period_start", {
    withTimezone: true,
  }).notNull(),

  currentPeriodEnd: timestamp("current_period_end", {
    withTimezone: true,
  }),

  trialStart: timestamp("trial_start", {
    withTimezone: true,
  }),

  trialEnd: timestamp("trial_end", {
    withTimezone: true,
  }),

  canceledAt: timestamp("canceled_at", {
    withTimezone: true,
  }),

  startedAt: timestamp("started_at", {
    withTimezone: true,
  }),

  endsAt: timestamp("ends_at", {
    withTimezone: true,
  }),

  endedAt: timestamp("ended_at", {
    withTimezone: true,
  }),

  customerId: text("customer_id").notNull(),
  productId: text("product_id")
    .notNull()
    .references(() => productTable.id, { onDelete: "cascade" }),
  discountId: text("discount_id"),
  checkoutId: text("checkout_id"),
  seats: integer("seats"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const productTable = pgTable("product", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  trialInterval: text("trial_interval"),
  trialIntervalCount: integer("trial_interval_count"),
  recurringInterval: text("recurring_interval").$type<"month" | "year">(),
  recurringIntervalCount: integer("recurring_interval_count"),
  isRecurring: boolean("is_recurring").notNull(),
  isArchived: boolean("is_archived").notNull(),
  externalOrganizationId: text("external_organization_id").notNull(),
  visibility: text("visibility").notNull(),
  prices: jsonb("prices"),
  metadata: jsonb("metadata").$type<{
    plan: "starter" | "professional";
    variant: "monthly" | "yearly";
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const jwtSecretTable = pgTable(
  "jwt_secret",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("jwt_secret_organizationId_idx").on(table.organizationId),
    unique("jwt_secret_organizationId_secret_revokedAt_uidx")
      .on(table.organizationId, table.secret, table.revokedAt)
      .nullsNotDistinct(),
    uniqueIndex("jwt_secret_organizationId_active_uidx")
      .on(table.organizationId)
      .where(sql`${table.revokedAt} is null`),
  ]
);

export type Organization = typeof organizationTable.$inferSelect;
export type NewOrganization = typeof organizationTable.$inferInsert;
