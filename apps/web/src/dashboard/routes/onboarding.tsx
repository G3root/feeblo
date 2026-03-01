/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingForm } from "~/features/onboarding/components/onboarding-form";
import { authClient } from "~/lib/auth-client";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search) => SearchSchema.parse(search),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { data: session } = authClient.useSession();

  const defaultOrganizationId = session?.organizations?.[0]?.id ?? null;
  const redirectTo =
    search.redirectTo?.startsWith("/") && search.redirectTo !== "/onboarding"
      ? search.redirectTo
      : defaultOrganizationId
        ? `/${defaultOrganizationId}`
        : "/";

  return (
    <OnboardingForm
      defaultName={session?.user?.name ?? ""}
      onCompleted={() => {
        navigate({ to: redirectTo });
      }}
    />
  );
}
