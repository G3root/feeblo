import { Link } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function BoardNotFound({
  organizationId,
  boardSlug,
}: {
  organizationId: string;
  boardSlug: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Board not found</CardTitle>
          <CardDescription>
            We could not find a board for <code>{boardSlug}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className="text-primary text-sm underline underline-offset-4"
            params={{ organizationId }}
            to="/$organizationId"
          >
            Go back to dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
