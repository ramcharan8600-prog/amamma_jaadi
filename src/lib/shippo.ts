/**
 * Minimal Shippo REST client (https://docs.goshippo.com). The API key is a
 * server-side secret (SHIPPO_API_KEY) passed in by the caller; it is never sent
 * to the browser or logged.
 */
const SHIPPO_API = 'https://api.goshippo.com';
const TIMEOUT_MS = 25_000;

export class ShippoError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ShippoError';
  }
}

export interface ShippoAddress {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

/** Ship-from and return address (owner, 2026-09-28). The phone goes to UPS. */
export const SHIP_FROM: ShippoAddress = {
  name: 'Amamma Jaadi',
  company: 'Amamma Jaadi',
  street1: '4006 W Plano Pkwy',
  city: 'Plano',
  state: 'TX',
  zip: '75093',
  country: 'US',
  phone: '5105745578',
  email: 'orders@amammajaadi.com',
};

export interface Parcel {
  length: number;
  width: number;
  height: number;
  weightLb: number;
}

export interface ShippoRate {
  rateId: string;
  provider: string;
  serviceToken: string;
  serviceName: string;
  amount: number;
  currency: string;
  estimatedDays: number | null;
  durationTerms: string | null;
}

/** Shippo's free-text messages ("Address not found", carrier notes). */
function messagesOf(body: unknown): string[] {
  const list = (body as { messages?: Array<{ text?: string; message?: string }> } | null)?.messages;
  return Array.isArray(list) ? list.map((m) => String(m.text ?? m.message ?? '')).filter(Boolean) : [];
}

async function call<T>(apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!apiKey) throw new ShippoError('Shippo is not configured (SHIPPO_API_KEY missing).');
  let response: Response;
  try {
    response = await fetch(`${SHIPPO_API}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ShippoError(`Could not reach Shippo: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const detail = messagesOf(body).join(' ') ||
      (body && typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : text.slice(0, 300));
    throw new ShippoError(`Shippo ${response.status}: ${detail || response.statusText}`, response.status);
  }
  return body as T;
}

const toShippoAddress = (a: ShippoAddress) => ({
  name: a.name, company: a.company ?? '', street1: a.street1, street2: a.street2 ?? '',
  city: a.city, state: a.state, zip: a.zip, country: a.country, phone: a.phone ?? '', email: a.email ?? '',
});

/** Ask Shippo (USPS address data) whether the address is deliverable. */
export async function validateAddress(apiKey: string, address: ShippoAddress): Promise<{ valid: boolean | null; messages: string[] }> {
  const body = await call<{ validation_results?: { is_valid?: boolean; messages?: Array<{ text?: string }> } }>(
    apiKey, '/addresses/', { body: { ...toShippoAddress(address), validate: true } },
  );
  const results = body.validation_results;
  return {
    valid: typeof results?.is_valid === 'boolean' ? results.is_valid : null,
    messages: (results?.messages ?? []).map((m) => String(m.text ?? '')).filter(Boolean),
  };
}

/** Create a shipment and get its rates. `reference` (AJ-xxxx) goes on the label's reference line. */
export async function createShipment(apiKey: string, params: {
  to: ShippoAddress;
  parcel: Parcel;
  shipDate: string;
  reference: string;
}): Promise<{ shipmentId: string; rates: ShippoRate[]; messages: string[] }> {
  const body = await call<{
    object_id: string;
    rates?: Array<{
      object_id: string; provider?: string; amount?: string; currency?: string;
      servicelevel?: { name?: string; token?: string }; estimated_days?: number | null; duration_terms?: string | null;
    }>;
    messages?: unknown;
  }>(apiKey, '/shipments/', {
    body: {
      address_from: toShippoAddress(SHIP_FROM),
      address_to: toShippoAddress(params.to),
      parcels: [{
        length: String(params.parcel.length), width: String(params.parcel.width), height: String(params.parcel.height),
        distance_unit: 'in', weight: String(params.parcel.weightLb), mass_unit: 'lb',
      }],
      shipment_date: `${params.shipDate}T17:00:00Z`,
      extra: { reference_1: params.reference },
      metadata: params.reference,
      async: false,
    },
  });
  return {
    shipmentId: body.object_id,
    rates: (body.rates ?? []).map((r) => ({
      rateId: r.object_id,
      provider: String(r.provider ?? ''),
      serviceToken: String(r.servicelevel?.token ?? ''),
      serviceName: String(r.servicelevel?.name ?? ''),
      amount: Number(r.amount),
      currency: String(r.currency ?? 'USD'),
      estimatedDays: typeof r.estimated_days === 'number' ? r.estimated_days : null,
      durationTerms: r.duration_terms ?? null,
    })),
    messages: messagesOf(body),
  };
}

/** Re-read one rate so the price and service bought are Shippo's, not the browser's. */
export async function getRate(apiKey: string, rateId: string): Promise<{ amount: number; currency: string; provider: string; serviceToken: string; serviceName: string; shipmentId: string | null }> {
  const r = await call<{ amount?: string; currency?: string; provider?: string; servicelevel?: { name?: string; token?: string }; shipment?: string }>(
    apiKey, `/rates/${encodeURIComponent(rateId)}`,
  );
  return {
    amount: Number(r.amount), currency: String(r.currency ?? 'USD'), provider: String(r.provider ?? ''),
    serviceToken: String(r.servicelevel?.token ?? ''), serviceName: String(r.servicelevel?.name ?? ''),
    shipmentId: r.shipment ?? null,
  };
}

export interface LabelPurchase {
  transactionId: string;
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  messages: string[];
}

/** Buy the label for a rate: a 4×6 PDF for the thermal printer. */
export async function buyLabel(apiKey: string, rateId: string, reference: string): Promise<LabelPurchase> {
  const t = await call<{
    object_id: string; status?: string; tracking_number?: string; tracking_url_provider?: string; label_url?: string; messages?: unknown;
  }>(apiKey, '/transactions/', { body: { rate: rateId, label_file_type: 'PDF_4x6', metadata: reference, async: false } });
  return {
    transactionId: t.object_id,
    status: String(t.status ?? ''),
    trackingNumber: t.tracking_number || null,
    trackingUrl: t.tracking_url_provider || null,
    labelUrl: t.label_url || null,
    messages: messagesOf(t),
  };
}

/** Void an unused label (Shippo refunds the label cost). */
export async function voidLabel(apiKey: string, transactionId: string): Promise<{ status: string }> {
  const r = await call<{ status?: string }>(apiKey, '/refunds/', { body: { transaction: transactionId, async: false } });
  return { status: String(r.status ?? '') };
}

/** Carrier tracking status: PRE_TRANSIT until UPS scans the box, then TRANSIT / DELIVERED / … */
export async function getTrackingStatus(apiKey: string, carrier: string, trackingNumber: string): Promise<string> {
  const t = await call<{ tracking_status?: { status?: string } | null }>(
    apiKey, `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,
  );
  return String(t.tracking_status?.status ?? 'UNKNOWN');
}
