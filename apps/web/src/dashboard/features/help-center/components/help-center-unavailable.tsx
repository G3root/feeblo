import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";

/**
 * What a deep link renders while the feature is switched off.
 *
 * The nav entry and the settings section are hidden by the same flag, so this
 * is only reached by a bookmark or a pasted URL. It says the feature is
 * unavailable rather than 404ing, because "this deployment does not have it"
 * and "this page does not exist" are different answers and only one of them is
 * true.
 */
export function HelpCenterUnavailable() {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>Help center is not available</EmptyTitle>
        <EmptyDescription>
          This deployment does not have the help center enabled.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
