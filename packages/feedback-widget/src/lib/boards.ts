export interface Board {
  id: string;
  name: string;
  count: number;
  description: string;
}

export const boards: Board[] = [
  {
    id: "feedback",
    name: "Feedback & Roadmaps",
    count: 1,
    description: "Suggest features and vote on what we build next",
  },
  {
    id: "support",
    name: "Support platform",
    count: 2,
    description: "Get help and report issues",
  },
  {
    id: "help",
    name: "Help Center",
    count: 3,
    description: "Browse articles and guides",
  },
  {
    id: "changelog",
    name: "Changelog",
    count: 4,
    description: "Stay up to date with product changes",
  },
  {
    id: "surveys",
    name: "Surveys",
    count: 5,
    description: "Share your thoughts in short surveys",
  },
  {
    id: "general",
    name: "General",
    count: 6,
    description: "Anything else on your mind",
  },
];

export function getBoard(id: string): Board | undefined {
  return boards.find((board) => board.id === id);
}
