import type { Post } from "@feeblo/domain/post/schema";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { buttonVariants } from "~/components/ui/button";
import { formatPostStatus, stripHtml, truncate } from "../../lib/utils";

export function FeatureCard({ post }: { post: Post }) {
  const description = truncate(stripHtml(post.content), 180) || "No details yet.";

  return (
    <Link className="block" href={`/p/${post.slug}`}>
      <Card className="ring-1 ring-border/60 transition-all hover:-translate-y-0.5 hover:ring-foreground/15">
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{formatPostStatus(post.status)}</Badge>
                {post.user.name ? (
                  <span className="text-muted-foreground text-xs">
                    Shared by {post.user.name}
                  </span>
                ) : null}
              </div>
              <CardTitle className="line-clamp-2">{post.title}</CardTitle>
            </div>

            <span className={buttonVariants({ size: "sm", variant: "outline" })}>
              {post.upVotes} votes
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm leading-6">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
