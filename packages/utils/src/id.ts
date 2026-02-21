import { createId, verifyId } from "legid";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

const prefixes = {
  organization: "org",
  member: "mem",
} as const;

export const generateId = <TPrefix extends keyof typeof prefixes>(
  prefix: TPrefix
) => `${prefixes[prefix]}-${nanoid()}`;

export const generatePublicId = () => createId({ approximateLength: 12 });

export const verifyPublicId = (publicId: string) => verifyId(publicId);
