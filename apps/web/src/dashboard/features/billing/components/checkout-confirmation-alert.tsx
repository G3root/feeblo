import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { useMachine } from "@xstate/react";

import {
  checkoutConfirmationMachine,
  toCheckoutConfirmationStatus,
} from "../lib/checkout-confirmation-machine";
import { PLAN_COPY, type PlanType } from "../lib/plans";

/**
 * The checkout-success alert.
 *
 * The route keys this component by `checkout_id` (and workspace), so a changed
 * id starts a fresh machine and a removed id removes the alert. That matters
 * because the machine seeds its checkout id from the actor input: remounting is
 * what keeps the automatic poll and the retry button from acting on a stale
 * route parameter. The machine owns the pending/confirmed/delayed/error states;
 * this component only renders them.
 */
export function CheckoutConfirmationAlert({
  checkoutId,
  organizationId,
  plan,
}: {
  readonly checkoutId: string;
  readonly organizationId: string;
  readonly plan: PlanType | undefined;
}) {
  const [snapshot, send] = useMachine(checkoutConfirmationMachine, {
    input: { checkoutId, organizationId, plan },
  });
  const status = toCheckoutConfirmationStatus(snapshot);

  if (status === "hidden") {
    return null;
  }

  return (
    <Alert
      variant={
        status === "confirmed"
          ? "success"
          : status === "error"
            ? "error"
            : "info"
      }
    >
      <AlertTitle>
        {status === "confirmed"
          ? "Subscription activated"
          : status === "delayed"
            ? "Subscription confirmation is taking longer than expected"
            : status === "error"
              ? "Could not refresh subscription status"
              : "Checkout completed — confirming your subscription"}
      </AlertTitle>
      <AlertDescription>
        {status === "confirmed"
          ? `This workspace now has the ${PLAN_COPY[snapshot.context.plan ?? "free"].name} plan.`
          : status === "pending"
            ? "Polar is confirming the subscription. This page will update automatically; it can take a few seconds."
            : "Your checkout may still be processing. Refresh the subscription status to try again."}
      </AlertDescription>
      {status === "delayed" || status === "error" ? (
        <Button
          className="mt-3"
          onClick={() => send({ type: "RETRY" })}
          size="sm"
          type="button"
          variant="outline"
        >
          Refresh status
        </Button>
      ) : null}
    </Alert>
  );
}
