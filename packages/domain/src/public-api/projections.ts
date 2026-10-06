import * as Layer from "effect/Layer";

import { PublicApiChangelogRepository } from "../changelog/public-api/repository";
import { PublicApiCommentRepository } from "../comments/public-api/repository";
import { CommentService } from "../comments/service";
import { PublicApiEndUserRepository } from "../contact/public-api/repository";
import { PublicApiPostRepository } from "../post/public-api/repository";
import { PublicApiVoteRepository } from "../upvote/public-api/repository";

/**
 * The public projections both `/api/v1` and `/mcp` serve, composed once.
 *
 * The reads that must not select actor identifiers (the post and comment
 * repositories), the changelog publication orchestration, and the dashboard's
 * comment write path: the layers only these two surfaces read. They are
 * declared here rather than in either surface so adding a resource's
 * projection is one line both surfaces receive, instead of a line in one
 * surface's list that the other can silently miss.
 *
 * The bundle still requires the feature repositories the projections are built
 * on — `PublicApiInternals`, provided by whoever composes the surface — and
 * each surface supplies that plus the two things that genuinely vary between
 * them: its key middleware and its endpoint or tool projection.
 */
export const PublicApiProjections = Layer.mergeAll(
  PublicApiChangelogRepository.layer,
  PublicApiCommentRepository.layer,
  PublicApiEndUserRepository.layer,
  PublicApiPostRepository.layer,
  PublicApiVoteRepository.layer,
  CommentService.layer
);
