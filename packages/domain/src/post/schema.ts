import { Schema } from "effect";

export class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  status: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export type TPost = Schema.Schema.Type<typeof Post>;

export const PostList = Schema.Struct({
  boardId: Schema.String,
});

export type TPostList = Schema.Schema.Type<typeof PostList>;

export const PostDelete = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
});

export type TPostDelete = Schema.Schema.Type<typeof PostDelete>;
