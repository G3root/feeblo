import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useUpgradePlanDialogContext } from "../dialog-stores";

export function PaidFeatureGate({ feature }: { feature: string }) {
  const upgradePlanStore = useUpgradePlanDialogContext();

  return (
    <div className="p-3">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={SparklesIcon} />
          </EmptyMedia>
          <EmptyTitle>{feature} requires an upgrade</EmptyTitle>
          <EmptyDescription>
            {feature} is available on the Starter plan or higher.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => upgradePlanStore.send({ type: "toggle" })}
            size="sm"
            type="button"
          >
            <HugeiconsIcon icon={SparklesIcon} />
            Upgrade plan
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
