import { esp03 } from './api/esp03';

/**
 * FIN-002: hand the browser to the PSP. The return page never trusts the redirect; it asks the server to verify.
 * A free order (no redirect) goes straight to the return page, which shows the receipt.
 */
export async function startPayment(orderId: string): Promise<void> {
  const returnUrl = `${window.location.origin}/payments/return`;
  const { redirectUrl } = await esp03.pay(orderId, returnUrl);
  window.location.assign(redirectUrl ?? `${returnUrl}?order=${encodeURIComponent(orderId)}`);
}
