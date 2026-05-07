import { Schema } from "effect";

export const WorkspaceId = Schema.String.pipe(
  Schema.brand("@Feeblo/WorkspaceId")
).annotate({
  description: "The ID of the workspace",
  title: "WorkspaceId ID",
});
export type TWorkspaceId = Schema.Schema.Type<typeof WorkspaceId>;

export const UserId = Schema.String.pipe(
  Schema.brand("@Feeblo/UserId")
).annotate({
  description: "The ID of the user",
  title: "UserId ID",
});
export type TUserId = Schema.Schema.Type<typeof UserId>;
