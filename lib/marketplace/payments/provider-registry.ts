import "server-only";
import type { MarketplacePaymentProvider } from "./provider";
import { PaystackMarketplaceProvider, StripeMarketplaceProvider } from "./providers";

/** Provider selection is server-controlled; clients cannot supply credentials or adapter IDs. */
export function getMarketplacePaymentProvider(id: string): MarketplacePaymentProvider {
  switch (id) {
    case "paystack": return new PaystackMarketplaceProvider();
    case "stripe": return new StripeMarketplaceProvider();
    default: throw new Error("unsupported_payment_provider");
  }
}
