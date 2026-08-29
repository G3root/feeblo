export * from "./legid";

import { makeId } from "./legid";

const approximateLength = 18;

export const JwtSecretId = makeId("jwt_secret", "jwt", {
  approximateLength,
});

export const WorkspaceId = makeId("workspace", "org", {
  approximateLength: 12,
});
export const UserId = makeId("user", "usr", {
  approximateLength,
});
export const SessionId = makeId("session", "ses", {
  approximateLength,
});
export const ProjectId = makeId("project", "prj", {
  approximateLength,
});
export const MemberId = makeId("member", "mem", {
  approximateLength,
});
export const BoardId = makeId("board", "brd", {
  approximateLength,
});
export const PostStatusId = makeId("post_status", "pss", {
  approximateLength,
});
export const PostId = makeId("post", "pst", {
  approximateLength,
});
export const UpvoteId = makeId("upvote", "upv", {
  approximateLength,
});
export const CommentReactionId = makeId("comment_reaction", "crt", {
  approximateLength,
});
export const CommentId = makeId("comment", "cmt", {
  approximateLength,
});
export const ReplyId = makeId("reply", "rpl", {
  approximateLength,
});
export const PostReactionId = makeId("post_reaction", "rct", {
  approximateLength,
});
export const PostSubscriptionId = makeId("post_subscription", "psb", {
  approximateLength,
});
export const ChangelogSubscriptionId = makeId("changelog_subscription", "cgs", {
  approximateLength,
});
export const EmailOutboxId = makeId("email_outbox", "eob", {
  approximateLength,
});
export const EmailDeliveryId = makeId("email_delivery", "edl", {
  approximateLength,
});
export const EmailContactId = makeId("email_contact", "ect", {
  approximateLength,
});
export const EmailSubscriptionId = makeId("email_subscription", "esb", {
  approximateLength,
});
export const PostActivityId = makeId("post_activity", "pac", {
  approximateLength,
});
export const NotificationId = makeId("notification", "ntf", {
  approximateLength,
});
export const SiteId = makeId("site", "sit", {
  approximateLength,
});
export const SubscriptionId = makeId("subscription", "sub", {
  approximateLength,
});
export const ChangelogId = makeId("changelog", "chg", {
  approximateLength,
});

export const ChangelogCategoryId = makeId("changelog_category", "chc", {
  approximateLength,
});

export const ChangelogCategoryLinkId = makeId(
  "changelog_category_link",
  "ccl",
  {
    approximateLength,
  }
);

export const RoadmapId = makeId("roadmap", "rmp", {
  approximateLength,
});

export const RoadmapColumnId = makeId("roadmap_column", "rmc", {
  approximateLength,
});

export const TagId = makeId("tag", "tag", {
  approximateLength,
});

export const PostTagId = makeId("post_tag", "ptg", {
  approximateLength,
});

export const ContactId = makeId("contact", "cnt", {
  approximateLength,
});

export const CompanyId = makeId("company", "cmp", {
  approximateLength,
});

export const ContactAttributeDefinitionId = makeId(
  "contact_attribute_definition",
  "cad",
  {
    approximateLength,
  }
);

export const ContactAttributeValueId = makeId(
  "contact_attribute_value",
  "cav",
  {
    approximateLength,
  }
);

export const CompanyAttributeDefinitionId = makeId(
  "company_attribute_definition",
  "yad",
  {
    approximateLength,
  }
);

export const CompanyAttributeValueId = makeId(
  "company_attribute_value",
  "yav",
  {
    approximateLength,
  }
);

export const AssetId = makeId("asset", "ast", {
  approximateLength,
});

/** Identifies one configured external integration connection. */
export const IntegrationConnectionId = makeId("integration_connection", "icn", {
  approximateLength,
});

/** Identifies one capability route beneath an integration connection. */
export const IntegrationRouteId = makeId("integration_route", "irt", {
  approximateLength,
});

/** Identifies one immutable fact emitted for external integrations. */
export const IntegrationEventId = makeId("integration_event", "iev", {
  approximateLength,
});

/** Identifies one durable execution of an event against a route. */
export const IntegrationDeliveryId = makeId("integration_delivery", "idl", {
  approximateLength,
});

/** Identifies one append-only integration delivery attempt. */
export const IntegrationDeliveryAttemptId = makeId(
  "integration_delivery_attempt",
  "ida",
  { approximateLength }
);

/** Identifies one provider-owned external resource. */
export const IntegrationExternalResourceId = makeId(
  "integration_external_resource",
  "ier",
  {
    approximateLength,
  }
);

/** Identifies one many-to-many relationship between a Feeblo post and an external resource. */
export const PostExternalResourceLinkId = makeId(
  "post_external_resource_link",
  "erl",
  {
    approximateLength,
  }
);

/** Identifies one organization-owned GitHub issue status rule. */
export const GitHubSyncRuleId = makeId("github_sync_rule", "gsr", {
  approximateLength,
});

/** Identifies one deduplicated GitHub webhook delivery. */
export const GitHubWebhookDeliveryId = makeId(
  "github_webhook_delivery",
  "gwd",
  { approximateLength }
);

/** Identifies a durable manually requested external-resource creation. */
export const ExternalResourceCreateRequestId = makeId(
  "external_resource_create_request",
  "erc",
  { approximateLength }
);
