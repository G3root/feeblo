import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema, transaction } from "@feeblo/db";
import { BoardId, PostId, PostStatusId, UserId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as S from "effect/Schema";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { PostRepository } from "../post/repository";
import { PostActivityRepository } from "../post-activity/repository";
import { UpvoteRepository } from "../upvote/repository";
import { type FeedbackAssessment, FeedbackAssessor } from "./interpreter";
import { FeedbackIngestionRepository } from "./repository";
import { CaptureFeedback } from "./schema";
import { FeedbackTriageService } from "./service";
import {
  FeedbackIngestionWorkflow,
  FeedbackIngestionWorkflowLayer,
} from "./workflow";

const assessment = {
  digest: "Customers need an audit trail for exported reports.",
  excerpts: ["We need to see who exported each report."],
  customerNeed: "Accountability for sensitive exports",
  tone: "NEUTRAL",
  priority: "MEDIUM",
  interpretationConfidence: 0.9,
  proposal: {
    action: "CREATE_POST",
    title: "Add an export audit trail",
    body: "Show who exported each report and when.",
    boardId: null,
    postId: null,
    rationale: "A new product capability was requested.",
  },
} as const satisfies FeedbackAssessment;

const Repositories = Layer.mergeAll(
  FeedbackIngestionRepository.layer,
  PostRepository.layer,
  PostActivityRepository.layer,
  UpvoteRepository.layer
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

const TestLayer = FeedbackTriageService.layer.pipe(
  Layer.provideMerge(Repositories)
);

const WorkflowTestLayer = FeedbackIngestionWorkflowLayer.pipe(
  Layer.provideMerge(FeedbackAssessor.manualLayer),
  Layer.provideMerge(FeedbackIngestionRepository.layer),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

const makeFixture = Effect.fn("FeedbackIngestionTest.makeFixture")(
  function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const userId = yield* UserId.generate;
    const boardId = yield* BoardId.generate;
    const statusId = yield* PostStatusId.generate;
    const postId = yield* PostId.generate;
    const memberId = `member_${organizationId}`;
    const now = new Date();

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Test workspace",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.userTable).values({
      id: userId,
      email: `${organizationId}@example.com`,
      name: "Test owner",
    });
    yield* db.insert(schema.memberTable).values({
      id: memberId,
      organizationId,
      userId,
      role: "owner",
      createdAt: now,
    });
    yield* db.insert(schema.boardTable).values({
      id: boardId,
      organizationId,
      name: "Feature requests",
      slug: `features-${organizationId}`,
      visibility: "PUBLIC",
      creatorId: userId,
      creatorMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postStatusTable).values({
      id: statusId,
      organizationId,
      type: "PENDING",
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
    });
    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId,
      boardId,
      statusId,
      title: "Existing export controls",
      slug: `existing-export-controls-${organizationId}`,
      content: "Existing request",
      excerpt: "Existing request",
      creatorId: userId,
      creatorMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      boardId,
      memberId,
      organizationId,
      postId,
      statusId,
      userId,
    };
  }
);

describe("feedback ingestion", () => {
  layer(TestLayer)("repository and triage", (it) => {
    it.effect("validates bounded, non-blank captured feedback", () =>
      Effect.gen(function* () {
        const organizationId = yield* WorkspaceId.generate;
        const valid = {
          organizationId,
          channel: { key: "api:default", kind: "API", label: "Public API" },
          deliveryKey: "request-123",
          sender: {},
          message: { text: "A valid request" },
          metadata: { source: ["api", true, null] },
        };

        yield* S.decodeUnknownEffect(CaptureFeedback)(valid);

        const invalid = S.decodeUnknownExit(CaptureFeedback)({
          ...valid,
          deliveryKey: "   ",
          message: { text: "x".repeat(10_001) },
        });
        expect(Exit.isFailure(invalid)).toBe(true);
      })
    );

    it.effect("normalizes contact email before lookup and creation", () =>
      Effect.gen(function* () {
        const repository = yield* FeedbackIngestionRepository;
        const fixture = yield* makeFixture();
        const input = {
          organizationId: fixture.organizationId,
          channel: { key: "api:default", kind: "API", label: "Public API" },
          sender: { email: "  CUSTOMER@EXAMPLE.COM  " },
          message: { text: "Please add export auditing." },
        } as const;
        const first = yield* transaction(
          repository.captureIdempotently({ ...input, deliveryKey: "request-1" })
        );
        const firstContactId = yield* transaction(
          repository.resolveIdentity({
            organizationId: fixture.organizationId,
            receiptId: first.receiptId,
          })
        );
        const second = yield* transaction(
          repository.captureIdempotently({
            ...input,
            deliveryKey: "request-2",
            sender: { email: "customer@example.com" },
          })
        );
        const secondContactId = yield* transaction(
          repository.resolveIdentity({
            organizationId: fixture.organizationId,
            receiptId: second.receiptId,
          })
        );

        expect(firstContactId).toBe(secondContactId);
      })
    );

    it.effect("returns triage items with an ascending keyset cursor", () =>
      Effect.gen(function* () {
        const repository = yield* FeedbackIngestionRepository;
        const fixture = yield* makeFixture();
        const receipts = yield* Effect.forEach(["1", "2", "3"], (suffix) =>
          transaction(
            repository.captureIdempotently({
              organizationId: fixture.organizationId,
              channel: { key: "api:default", kind: "API", label: "Public API" },
              deliveryKey: `page-${suffix}`,
              sender: {},
              message: { text: `Feedback ${suffix}` },
            })
          )
        );
        yield* Effect.forEach(receipts, (receipt) =>
          transaction(
            repository.persistAssessment({
              organizationId: fixture.organizationId,
              receiptId: receipt.receiptId,
              assessment,
            })
          )
        );

        const firstPage = yield* repository.listTriageItems({
          organizationId: fixture.organizationId,
          pageSize: 2,
        });
        const secondPage = yield* repository.listTriageItems({
          organizationId: fixture.organizationId,
          pageSize: 2,
          cursor: firstPage.nextCursor ?? undefined,
        });

        expect(firstPage.items).toHaveLength(2);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.id).not.toBe(firstPage.items[1]?.id);
        expect(secondPage.nextCursor).toBeNull();
      })
    );

    it.effect(
      "rejects triage items whose receipt belongs to another workspace",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* FeedbackIngestionRepository;
          const fixture = yield* makeFixture();
          const foreignOrganizationId = yield* WorkspaceId.generate;
          const now = new Date();

          yield* db.insert(schema.organizationTable).values({
            id: foreignOrganizationId,
            name: "Foreign workspace",
            slug: foreignOrganizationId,
            createdAt: now,
          });
          const foreignReceipt = yield* transaction(
            repository.captureIdempotently({
              organizationId: foreignOrganizationId,
              channel: {
                key: "api:default",
                kind: "API",
                label: "Public API",
              },
              deliveryKey: "foreign-request-123",
              sender: {},
              message: { text: "Foreign feedback" },
              metadata: {},
            })
          );

          const result = yield* Effect.exit(
            transaction(
              repository.persistAssessment({
                organizationId: fixture.organizationId,
                receiptId: foreignReceipt.receiptId,
                assessment,
              })
            )
          );

          expect(Exit.isFailure(result)).toBe(true);
        })
    );

    it.effect("captures idempotently and attaches a contact vote once", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* FeedbackIngestionRepository;
        const triage = yield* FeedbackTriageService;
        const fixture = yield* makeFixture();
        const captureInput = {
          organizationId: fixture.organizationId,
          channel: {
            key: "slack:C123",
            kind: "SLACK",
            label: "#customer-feedback",
          },
          upstreamItemId: "1700000000.000100",
          deliveryKey: "slack:C123:1700000000.000100",
          sender: {
            upstreamId: "U123",
            email: "customer@example.com",
            name: "Ada Customer",
          },
          message: {
            text: "We need to see who exported each report.",
          },
          metadata: { channelId: "C123" },
        } as const;

        const first = yield* transaction(
          repository.captureIdempotently(captureInput)
        );
        const duplicate = yield* transaction(
          repository.captureIdempotently(captureInput)
        );

        expect(first.status).toBe("CREATED");
        expect(duplicate).toEqual({
          status: "DUPLICATE",
          receiptId: first.receiptId,
        });

        const contactId = yield* transaction(
          repository.resolveIdentity({
            organizationId: fixture.organizationId,
            receiptId: first.receiptId,
          })
        );
        expect(contactId).not.toBeNull();

        const followUp = yield* transaction(
          repository.captureIdempotently({
            ...captureInput,
            upstreamItemId: "1700000000.000200",
            deliveryKey: "slack:C123:1700000000.000200",
            sender: {
              upstreamId: "U123",
              name: "Ada Customer",
            },
            message: {
              text: "This is still blocking our compliance review.",
            },
          })
        );
        const followUpContactId = yield* transaction(
          repository.resolveIdentity({
            organizationId: fixture.organizationId,
            receiptId: followUp.receiptId,
          })
        );
        expect(followUpContactId).toBe(contactId);

        yield* transaction(
          repository.persistAssessment({
            organizationId: fixture.organizationId,
            receiptId: first.receiptId,
            assessment,
          })
        );

        const { items: [triageItem] } = yield* repository.listTriageItems({
          organizationId: fixture.organizationId,
          status: "OPEN",
          pageSize: 100,
        });
        expect(triageItem).toMatchObject({
          senderEmail: "customer@example.com",
          channelKind: "SLACK",
          proposedTitle: "Add an export audit trail",
        });
        if (!triageItem) {
          return;
        }

        const resolution = yield* triage.linkPost({
          organizationId: fixture.organizationId,
          triageItemId: triageItem.id,
          postId: fixture.postId,
          actorId: fixture.userId,
          memberId: fixture.memberId,
        });
        expect(resolution).toEqual({
          status: "POST_LINKED",
          postId: fixture.postId,
        });

        const votes = yield* db
          .select({
            contactId: schema.upvoteTable.contactId,
            userId: schema.upvoteTable.userId,
          })
          .from(schema.upvoteTable);
        expect(votes).toEqual([{ contactId, userId: null }]);

        const { items: [resolved] } = yield* repository.listTriageItems({
          organizationId: fixture.organizationId,
          status: "POST_LINKED",
          pageSize: 100,
        });
        expect(resolved?.id).toBe(triageItem.id);

        const error = yield* Effect.flip(
          triage.linkPost({
            organizationId: fixture.organizationId,
            triageItemId: triageItem.id,
            postId: fixture.postId,
            actorId: fixture.userId,
            memberId: fixture.memberId,
          })
        );
        expect(error._tag).toBe("FeedbackTriageAlreadyDecidedError");
      })
    );
  });

  layer(WorkflowTestLayer)("durable workflow", (it) => {
    it.effect("resolves identity and produces an open triage item", () =>
      Effect.gen(function* () {
        const repository = yield* FeedbackIngestionRepository;
        const fixture = yield* makeFixture();
        const captured = yield* transaction(
          repository.captureIdempotently({
            organizationId: fixture.organizationId,
            channel: {
              key: "api:default",
              kind: "API",
              label: "Public API",
            },
            deliveryKey: "request-123",
            sender: {
              upstreamId: "customer-123",
              email: "workflow@example.com",
              name: "Workflow Customer",
            },
            message: {
              title: "Export audit trail",
              text: "We need to see who exported each report.",
            },
          })
        );

        yield* FeedbackIngestionWorkflow.execute({
          organizationId: fixture.organizationId,
          receiptId: captured.receiptId,
        });

        const { items: [triageItem] } = yield* repository.listTriageItems({
          organizationId: fixture.organizationId,
          status: "OPEN",
          pageSize: 100,
        });
        expect(triageItem).toMatchObject({
          senderEmail: "workflow@example.com",
          channelKind: "API",
          proposedTitle: "Export audit trail",
          action: "CREATE_POST",
        });
        expect(triageItem?.contactId).not.toBeNull();
      })
    );
  });
});
