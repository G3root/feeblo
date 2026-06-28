import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

const prefixes = {
  organization: "org",
  workspace: "org",
  project: "prj",
  member: "mem",
  board: "brd",
  postStatus: "pss",
  post: "pst",
  upvote: "upv",
  commentReaction: "crt",
  comment: "cmt",
  reply: "rpl",
  postReaction: "rct",
  site: "sit",
  subscription: "sub",
  changelog: "chg",
} as const;

export const generateId = <TPrefix extends keyof typeof prefixes>(
  prefix: TPrefix
) => `${prefixes[prefix]}-${nanoid()}`;

