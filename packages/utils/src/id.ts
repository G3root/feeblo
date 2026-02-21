import { createId, verifyId } from "legid";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

const prefixes = {
  organization: "org",
  project: "prj",
  member: "mem",
  board: "brd",
  post: "pst",
  upvote: "upv",
  comment: "cmt",
  reply: "rpl",
  reaction: "rct",
  site: "sit",
} as const;

export const generateId = <TPrefix extends keyof typeof prefixes>(
  prefix: TPrefix
) => `${prefixes[prefix]}-${nanoid()}`;

export const generatePublicId = () => createId({ approximateLength: 12 });

export const verifyPublicId = (publicId: string) => verifyId(publicId);
