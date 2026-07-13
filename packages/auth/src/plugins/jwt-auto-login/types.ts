import type { Session, User } from "better-auth";

export type JwtAutoLoginSession = { session: Session; user: User } & {
  user: { restrictedToOrganizationId: string | null };
} & Record<string, any>;

export interface UserWithJwtAutoLogin extends User {
  restrictedToOrganizationId: string;
}
