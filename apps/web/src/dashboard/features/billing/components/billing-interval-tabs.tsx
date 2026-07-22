import { Badge } from "@feeblo/ui/badge";
import { Tabs, TabsList, TabsTab } from "@feeblo/ui/tabs";
import type { BillingInterval } from "../lib/plans";

export function BillingIntervalTabs({
  onValueChange,
  value,
}: {
  onValueChange: (value: BillingInterval) => void;
  value: BillingInterval;
}) {
  return (
    <Tabs
      onValueChange={(nextValue) => onValueChange(nextValue as BillingInterval)}
      value={value}
    >
      <TabsList>
        <TabsTab value="month">Monthly</TabsTab>
        <TabsTab value="year">
          Yearly <Badge>2 Months Free</Badge>
        </TabsTab>
      </TabsList>
    </Tabs>
  );
}
