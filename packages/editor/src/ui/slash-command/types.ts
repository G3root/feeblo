import type { Editor, Range } from "@tiptap/core";
import type { ReactNode } from "react";

export type SlashCommandCategory = string;

export interface SearchableItem {
  description: string;
  searchTerms?: string[];
  title: string;
}

export interface SlashCommandItem extends SearchableItem {
  category: SlashCommandCategory;
  command: (props: SlashCommandProps) => void;
  icon: ReactNode;
}

export interface SlashCommandProps {
  editor: Editor;
  range: Range;
}

export interface SlashCommandRenderProps {
  items: SlashCommandItem[];
  onSelect: (index: number) => void;
  query: string;
  selectedIndex: number;
}

export interface SlashCommandRootProps {
  allow?: (props: { editor: Editor }) => boolean;
  char?: string;
  children?: (props: SlashCommandRenderProps) => ReactNode;
  filterItems?: (
    items: SlashCommandItem[],
    query: string,
    editor: Editor
  ) => SlashCommandItem[];
  items?: SlashCommandItem[];
}
