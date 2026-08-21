import { PlansResponse, type TPlanPricing } from "@feeblo/domain/pricing/schema";
import { plansEndpoint } from "@feeblo/web-shared/auth-client";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";

/**
 * Loads the public plan catalog (capabilities, limits, feature rows, and
 * current prices) that powers plan pickers. The response is the same payload
 * the marketing pricing table renders, so both surfaces stay in sync.
 */
export const usePlanCatalog = () =>
  useQuery({
    queryKey: ["plan-catalog"],
    queryFn: async ({ signal }): Promise<readonly TPlanPricing[]> => {
      const response = await fetch(plansEndpoint, { signal });

      if (!response.ok) {
        throw new Error(`Failed to load plans: ${response.status}`);
      }

      // SAFETY: The endpoint contract guarantees this shape; Schema rejects
      // any drift instead of leaking it into the UI.
      return Schema.decodeUnknownSync(PlansResponse)(await response.json())
        .plans;
    },
    // The API response itself is HTTP-cacheable for an hour; keep resolved
    // data fresh for the session on top of that.
    staleTime: 5 * 60 * 1000,
  });
