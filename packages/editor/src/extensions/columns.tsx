import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const COLUMN_PARENT_TYPES = [
  "twoColumns",
  "threeColumns",
  "fourColumns",
] as const;

const COLUMN_PARENT_SET = new Set<string>(COLUMN_PARENT_TYPES);
export const MAX_COLUMNS_DEPTH = 3;

export function getColumnsDepth(doc: ProseMirrorNode, from: number): number {
  const $from = doc.resolve(from);
  let depth = 0;
  for (let d = $from.depth; d > 0; d--) {
    if (COLUMN_PARENT_SET.has($from.node(d).type.name)) {
      depth++;
    }
  }
  return depth;
}
