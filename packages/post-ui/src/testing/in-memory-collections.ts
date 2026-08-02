import type { SyncConfig } from "@tanstack/db";
import { createCollection } from "@tanstack/react-db";

type WriteOp<T extends object> = Parameters<
  SyncConfig<T, string>["sync"]
>[0]["write"];

type CreateMockCollectionConfig<T extends object> = {
  id: string;
  getKey: (item: T) => string;
  initialData?: T[];
};

/**
 * Creates a collection backed by an in-memory sync that seeds `initialData`
 * and immediately marks the collection ready. Mirrors the `mockSyncCollectionOptions`
 * helper used by the TanStack DB test suite, including the `utils` write API so
 * tests can drive reactive updates deterministically.
 */
export function createMockCollection<T extends object>({
  id,
  getKey,
  initialData = [],
}: CreateMockCollectionConfig<T>) {
  let begin: (() => void) | undefined;
  let write: WriteOp<T> | undefined;
  let commit: (() => void) | undefined;

  const sync: SyncConfig<T, string> = {
    sync: ({ begin: b, write: w, commit: c, markReady }) => {
      begin = b;
      write = w;
      commit = c;

      b();
      for (const item of initialData) {
        w({ type: "insert", value: item });
      }
      c();
      markReady();
    },
  };

  const utils = {
    begin: () => begin?.(),
    write: ((value) => write?.(value)) as WriteOp<T>,
    commit: () => commit?.(),
  };

  return createCollection<T, string, typeof utils>({
    id,
    getKey,
    sync,
    startSync: true,
    onInsert: async () => {
      // In-memory sync has no persistence to await.
    },
    onUpdate: async () => {
      // In-memory sync has no persistence to await.
    },
    onDelete: async () => {
      // In-memory sync has no persistence to await.
    },
    utils,
  });
}
