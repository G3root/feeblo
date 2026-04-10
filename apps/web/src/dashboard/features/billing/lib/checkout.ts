import { toastManager } from "~/components/ui/toast";
import { fetchRpc } from "~/lib/runtime";

export async function startBillingCheckout({
  organizationId,
  productId,
}: {
  organizationId: string;
  productId: string;
}) {
  try {
    const result = await fetchRpc((rpc) =>
      rpc.BillingCheckout({
        organizationId,
        productId,
      })
    );

    window.location.href = result.url;
    return true;
  } catch (_error) {
    toastManager.add({
      title: "Failed to create checkout session.",
      type: "error",
    });

    return false;
  }
}

export async function startBillingPortal({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    const result = await fetchRpc((rpc) =>
      rpc.BillingPortal({
        organizationId,
      })
    );

    window.location.href = result.url;
    return true;
  } catch (_error) {
    toastManager.add({
      title: "Failed to open billing portal.",
      type: "error",
    });

    return false;
  }
}
