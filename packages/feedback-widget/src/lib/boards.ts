import {
  BookOpen01Icon,
  ClipboardIcon,
  CustomerService01Icon,
  Idea01Icon,
  Megaphone01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

export interface Board {
  id: string;
  name: string;
  icon: typeof Idea01Icon;
  count: number;
  description: string;
}

export const boards: Board[] = [
  {
    id: "feedback",
    name: "Feedback & Roadmaps",
    icon: Idea01Icon,
    count: 1,
    description: "Suggest features and vote on what we build next",
  },
  {
    id: "support",
    name: "Support platform",
    icon: CustomerService01Icon,
    count: 2,
    description: "Get help and report issues",
  },
  {
    id: "help",
    name: "Help Center",
    icon: BookOpen01Icon,
    count: 3,
    description: "Browse articles and guides",
  },
  {
    id: "changelog",
    name: "Changelog",
    icon: Megaphone01Icon,
    count: 4,
    description: "Stay up to date with product changes",
  },
  {
    id: "surveys",
    name: "Surveys",
    icon: ClipboardIcon,
    count: 5,
    description: "Share your thoughts in short surveys",
  },
  {
    id: "general",
    name: "General",
    icon: SparklesIcon,
    count: 6,
    description: "Anything else on your mind",
  },
];

export function getBoard(id: string): Board | undefined {
  return boards.find((board) => board.id === id);
}
