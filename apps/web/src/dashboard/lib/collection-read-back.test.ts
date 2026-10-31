import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

/**
 * Pins why every `onInsert`/`onUpdate`/`onDelete` in `collections.ts` ends with
 * an awaited `collection.utils.refetch({ throwOnError: true })`.
 *
 * TanStack DB 1.0 removed the Query Collection's implicit refetch. A handler
 * that only awaits its RPC now settles the transaction with the Query cache
 * still holding the *pre-write* row, and dropping the optimistic layer reverts
 * the row to it — the server accepted the write and the UI throws it away.
 * Nothing in the type system says so, so this test says it instead.
 *
 * These collections are built from the real adapter against an in-memory
 * "server", which is what makes the assertion about adapter behaviour rather
 * than about a mock that was written to agree with it.
 */

interface Row {
  id: string;
  text: string;
}

/**
 * A collection whose `onUpdate` mirrors the production handler shape, minus
 * the RPC: write to the backing "server" row, then optionally read back.
 */
function collectionWith(server: Array<Row>, readBack: boolean) {
  return createCollection(
    queryCollectionOptions({
      id: `read-back-${readBack ? "with" : "without"}`,
      queryClient: new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
      queryKey: ["read-back-test"],
      queryFn: async () => server.map((row) => ({ ...row })),
      getKey: (row) => row.id,
      onUpdate: async ({ collection, transaction }) => {
        const [mutation] = transaction.mutations;
        const changed = server.find((row) => row.id === mutation!.key);

        if (changed) {
          changed.text = String(mutation!.changes.text);
        }

        if (readBack) {
          await collection.utils.refetch({ throwOnError: true });
        }
      },
    })
  );
}

describe("query collection mutation read-back", () => {
  it("reverts the optimistic row when the handler does not read back", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    const collection = collectionWith(server, false);
    await collection.preload();

    const transaction = collection.update("1", (draft) => {
      draft.text = "after";
    });

    // The optimistic layer shows the intended value...
    expect(collection.get("1")?.text).toBe("after");
    await transaction.when("settled");

    // ...and settling without a read-back discards it, although the server
    // holds "after". This is the 1.0 behaviour, not a bug to work around.
    expect(server[0]?.text).toBe("after");
    expect(collection.get("1")?.text).toBe("before");
  });

  it("keeps the confirmed row when the handler reads back", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    const collection = collectionWith(server, true);
    await collection.preload();

    await collection
      .update("1", (draft) => {
        draft.text = "after";
      })
      .when("settled");

    expect(collection.get("1")?.text).toBe("after");
  });

  it("rejects the transaction when the required read-back fails", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    let failReadBack = false;
    const collection = createCollection(
      queryCollectionOptions({
        id: "read-back-failing",
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        }),
        queryKey: ["read-back-failing"],
        queryFn: async () => {
          if (failReadBack) {
            throw new Error("read-back failed");
          }
          return server.map((row) => ({ ...row }));
        },
        getKey: (row) => row.id,
        onUpdate: async ({ collection: target, transaction }) => {
          const [mutation] = transaction.mutations;
          const changed = server.find((row) => row.id === mutation!.key);

          if (changed) {
            changed.text = String(mutation!.changes.text);
          }

          await target.utils.refetch({ throwOnError: true });
        },
      })
    );
    await collection.preload();
    failReadBack = true;

    await expect(
      collection
        .update("1", (draft) => {
          draft.text = "after";
        })
        .when("settled")
    ).rejects.toThrow("read-back failed");

    // The unconfirmed write rolls back instead of leaving an optimistic row
    // the client could not read back.
    expect(collection.get("1")?.text).toBe("before");
  });
});

describe("settleOptimisticMutation", () => {
  it("reports success once the transaction settles", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    const collection = collectionWith(server, true);
    await collection.preload();

    const settled = new Promise<"success" | "error">((resolve) => {
      settleOptimisticMutation(
        () =>
          collection.update("1", (draft) => {
            draft.text = "after";
          }),
        () => resolve("success"),
        () => resolve("error")
      );
    });

    await expect(settled).resolves.toBe("success");
  });

  it("reports failure when the handler rejects", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    const collection = createCollection(
      queryCollectionOptions({
        id: "read-back-rejecting",
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        }),
        queryKey: ["read-back-rejecting"],
        queryFn: async () => server.map((row) => ({ ...row })),
        getKey: (row) => row.id,
        onUpdate: async () => {
          throw new Error("server refused the write");
        },
      })
    );
    await collection.preload();

    const settled = new Promise<"success" | "error">((resolve) => {
      settleOptimisticMutation(
        () =>
          collection.update("1", (draft) => {
            draft.text = "after";
          }),
        () => resolve("success"),
        () => resolve("error")
      );
    });

    await expect(settled).resolves.toBe("error");
    // The optimistic write was rolled back, so the row keeps the server value.
    expect(collection.get("1")?.text).toBe("before");
  });

  it("reports failure when the row is already gone", async () => {
    const server: Array<Row> = [{ id: "1", text: "before" }];
    const collection = collectionWith(server, true);
    await collection.preload();

    const settled = new Promise<"success" | "error">((resolve) => {
      // `update` throws synchronously for a key the collection does not hold;
      // the helper routes that through `onError` instead of letting it escape.
      settleOptimisticMutation(
        () =>
          collection.update("missing", (draft) => {
            draft.text = "after";
          }),
        () => resolve("success"),
        () => resolve("error")
      );
    });

    await expect(settled).resolves.toBe("error");
  });
});
