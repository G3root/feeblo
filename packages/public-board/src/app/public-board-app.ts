import type { Site } from "@feeblo/domain/site/schema";

export interface PublicBoardAppProps {
  readonly basePath?: string;
  readonly site: Site;
}
