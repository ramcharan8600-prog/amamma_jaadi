import { ok } from '@/lib/api';
import { getSquarePublicConfig, isSquareEnabled } from '@/lib/square';

/**
 * GET /api/payments/config — the public Square values (application id,
 * location id, sandbox or production), the same ones create-session returns.
 * Checkout reads them on the details step to load Square's card form early,
 * so the payment step opens without the ~2s Square setup. Nothing secret.
 */
export async function GET() {
  const square = getSquarePublicConfig();
  const enabled = isSquareEnabled();
  return ok({
    squareEnabled: enabled,
    squareAppId: enabled ? square.appId || null : null,
    squareLocationId: enabled ? square.locationId || null : null,
    squareEnvironment: square.environment,
  });
}
