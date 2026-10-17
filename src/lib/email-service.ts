/**
 * Transactional email templates backed by the durable D1/Queue outbox.
 *
 * Supported email types:
 * 1. Order confirmation
 * 2. Pickup ready notification
 * 3. Delivery/shipping confirmation
 *
 * Provider delivery happens asynchronously in the custom Worker Queue consumer.
 */

import { shipWeekDays } from '@/lib/delivery-limit';
import { BRAND_NAME, PHONE_NUMBER, SITE_URL, WHATSAPP_NUMBER } from '@/lib/constants';
import { formatPickupDate } from '@/lib/date';
import { SALES_TAX_LABEL, shippingMethodLabel } from '@/lib/pricing';
import { enqueueEmail, isEmailOutboxConfigured, type EmailOutboxPayload } from '@/lib/email-outbox';
import { ORDER_CONFIRMATION_BCC, REFUND_EMAIL_CC } from '@/lib/email-recipients';
import { PRODUCTS } from '@/data/products';
import type { DeliveryShippingMethod } from '@/types';

const PICKLE_PRODUCT_NAMES = new Set(
  PRODUCTS.filter((product) => product.category === 'pickles').map((product) => product.name.trim().toLowerCase())
);

function containsOnlyPickles(items: ReadonlyArray<{ name: string }>): boolean {
  return items.length > 0 && items.every((item) => PICKLE_PRODUCT_NAMES.has(item.name.trim().toLowerCase()));
}

/**
 * Owner inboxes for new-order notifications (comma-separated env value).
 * Used directly when the customer gave no email and for event inquiries.
 */
function getOwnerEmails(): string[] {
  return (process.env.OWNER_NOTIFICATION_EMAIL || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

export function isEmailConfigured(): boolean {
  // Accept mail into D1 even while the active provider is unavailable or over quota.
  return isEmailOutboxConfigured();
}

/** Small grey lines under an item name, e.g. what goes in a box. */
function itemDetailsHtml(details: string[] | undefined): string {
  return details?.length
    ? details.map((line) => `<br /><span style="font-size:12px; color:#666;">${escapeHtml(line)}</span>`).join('')
    : '';
}

/** Escape user-influenced values before interpolating into email HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailParams {
  to: string | string[];
  subject: string;
  html: string;
  /** Visible carbon-copy recipients. */
  cc?: string[];
  /** Hidden recipients — not visible to the primary recipient. */
  bcc?: string[];
  /** Stable business key used to prevent duplicate sends. */
  dedupeKey: string;
}

/** Persist first, then publish to the Cloudflare Queue for delivery/retries. */
async function sendEmail(params: EmailParams): Promise<{ success: boolean; id?: string }> {
  return enqueueEmail(params);
}

// ─── Email Templates ──────────────────────────────────────────

export function baseTemplate(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #2D2926;">
      <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #5C1626;">
        <table align="center" style="margin: 0 auto;">
          <tr>
            <td style="vertical-align: middle; padding-right: 13.2px;">
              <img src="${SITE_URL}/images/brand/email-logo.png" alt="${BRAND_NAME}" width="57" height="57" style="display: block; width: 57.2px; height: 57.2px; border-radius: 50%;" />
            </td>
            <td style="vertical-align: middle; text-align: left;">
              <div style="color: #7B1F1F; font-size: 26.4px; font-weight: bold; line-height: 1.1;">${BRAND_NAME}</div>
              <div style="color: #C6992E; font-size: 13.2px; letter-spacing: 2.2px;">FLAVORS OF HOME</div>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding: 24px 0;">${content}</div>
      <div style="border-top: 1px solid #eee; padding: 16px 0; text-align: center; font-size: 12px; color: #999;">
        <p>${BRAND_NAME} · Dallas, TX · <a href="https://wa.me/${WHATSAPP_NUMBER}" style="color: #7B1F1F;">WhatsApp</a></p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Subtotal / tax / delivery rows for an order table footer.
 *
 * Lines that don't apply are omitted rather than shown as $0.00: tax is hidden
 * while the sales-tax rate is 0, and delivery only appears for delivery orders.
 * Returns '' when there's no breakdown to show, leaving just the Total row.
 */
function totalsFooterRows(params: {
  subtotal?: number;
  tax?: number;
  shipping?: number;
  maintenanceFee?: number;
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  picklesOnly?: boolean;
  shippingLabel?: string;
}): string {
  if (params.subtotal == null) return '';

  const cell = 'padding:2px 0; color:#666;';
  const rows: string[] = [
    `<tr><td colspan="2" style="padding:10px 0 2px; color:#666;">Subtotal</td>
     <td style="text-align:right; padding:10px 0 2px; color:#666;">$${Number(params.subtotal).toFixed(2)}</td></tr>`,
  ];

  if (Number(params.tax) > 0) {
    rows.push(
      `<tr><td colspan="2" style="${cell}">${SALES_TAX_LABEL}</td>
       <td style="text-align:right; ${cell}">$${Number(params.tax).toFixed(2)}</td></tr>`
    );
  }

  if (params.fulfillmentType === 'delivery') {
    const fee = Number(params.shipping) > 0 ? `$${Number(params.shipping).toFixed(2)}` : 'Free';
    rows.push(
      `<tr><td colspan="2" style="${cell}">${escapeHtml(params.shippingLabel ?? shippingMethodLabel(params.shippingMethod, params.picklesOnly))}</td>
       <td style="text-align:right; ${cell}">${fee}</td></tr>`
    );
  }

  if (Number(params.maintenanceFee) > 0) {
    rows.push(`<tr><td colspan="2" style="${cell}">Operational fee</td>
      <td style="text-align:right; ${cell}">$${Number(params.maintenanceFee).toFixed(2)}</td></tr>`);
  }

  // Breathing room before the Total rule.
  return rows.join('') + '<tr><td colspan="3" style="padding-bottom:8px;"></td></tr>';
}

/** 1. Order Confirmation */
export interface OrderConfirmationParams {
  email: string;
  orderNumber: string;
  squarePaymentId: string;
  customerName: string;
  phone: string;
  total: number;
  /** Pre-tax subtotal — omit to hide the breakdown (older callers). */
  subtotal?: number;
  /** Sales tax charged on this order. */
  tax?: number;
  /** Delivery fee charged (0 / omitted = free or pickup). */
  shipping?: number;
  maintenanceFee?: number;
  items: Array<{ name: string; quantity: number; price: number; details?: string[] }>;
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  /** Trusted paid-cart classification; older callers fall back to catalog names. */
  picklesOnly?: boolean;
  /** The service label checkout showed (see deliveryServiceLabel); older callers fall back to the method. */
  shippingLabel?: string;
  /** Pickup date (YYYY-MM-DD) — shown for pickup orders. */
  pickupDate?: string;
  /** Pickup location (name + address) — shown for pickup orders. */
  pickupLocation?: string;
  /** Pickup window for the chosen location, e.g. "6:30 PM and 10:25 PM". */
  pickupHours?: string;
  /** Delivery address — shown for delivery orders. */
  deliveryAddress?: string;
  /** When the order was placed (defaults to now). */
  placedAt?: Date;
  /** Delivery shipment week chosen at checkout (its Monday, YYYY-MM-DD). */
  shipWeek?: string;
}

/** Render before the order transaction so its durable email intent commits with it. */
export function buildOrderConfirmationEmail(params: OrderConfirmationParams): EmailOutboxPayload {
  const picklesOnly = params.picklesOnly ?? containsOnlyPickles(params.items);
  const itemsHtml = params.items
    .map((i) => `<tr><td style="padding:8px 0;">${escapeHtml(i.name)}${itemDetailsHtml(i.details)}</td><td style="text-align:center;">${Number(i.quantity) || 0}</td><td style="text-align:right;">$${(Number(i.price) || 0).toFixed(2)}</td></tr>`)
    .join('');

  const fulfillmentHtml =
    params.fulfillmentType === 'pickup'
      ? `
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; font-weight: bold; color: #7B1F1F;">Pickup</p>
      ${params.pickupDate ? `<p style="margin: 0 0 6px; color: #2D2926; font-size: 16px;"><strong>Date:</strong> <strong style="color: #7B1F1F;">${escapeHtml(formatPickupDate(params.pickupDate))}</strong></p>` : ''}
      ${params.pickupLocation ? `<p style="margin: 0 0 6px; color: #444;">${escapeHtml(params.pickupLocation)}</p>` : ''}
      <p style="margin: 0; color: #666;">You can pick up your order between <strong>${escapeHtml(params.pickupHours ?? '6:30 PM and 12:45 AM')}</strong> at the selected location.</p>
    </div>`
      : `
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; font-weight: bold; color: #7B1F1F;">Delivery</p>
      ${params.deliveryAddress ? `<p style="margin: 0 0 6px; color: #444; white-space: pre-line;">${escapeHtml(params.deliveryAddress)}</p>` : ''}
      <p style="margin: 0 0 6px; color: #444;"><strong>Method:</strong> ${escapeHtml(params.shippingLabel ?? shippingMethodLabel(params.shippingMethod, picklesOnly))}</p>
      ${picklesOnly ? '' : `<p style="margin: 0 0 6px; color: #444;">Our sweets are <strong>freshly made</strong> after your order is confirmed.</p>`}
      <p style="margin: 0; color: #666;">We&apos;ll share tracking details for your delivery shortly.</p>
    </div>`;

  const html = baseTemplate(`
    <h2 style="color: #1B4332;">Order Confirmed!</h2>
    <p>Hi ${escapeHtml(params.customerName) || 'there'},<br />Thank you for your order. Here are the order details:</p>
    <p style="background: #FFF8F0; padding: 12px; border-radius: 8px; font-size: 18px; text-align: center;">
      Order <strong style="color: #7B1F1F;">${params.orderNumber}</strong>
    </p>
    <div style="font-size: 14px; color: #444; margin: 0 0 8px;">
      <p style="margin: 2px 0;"><strong>Name:</strong> ${escapeHtml(params.customerName)}</p>
      <p style="margin: 2px 0;"><strong>Phone:</strong> ${escapeHtml(params.phone)}</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <thead><tr style="border-bottom: 2px solid #eee;">
        <th style="text-align:left; padding:8px 0;">Item</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Price</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        ${totalsFooterRows({ ...params, picklesOnly })}
        <tr style="border-top: 2px solid #7B1F1F;">
          <td colspan="2" style="padding:12px 0; font-weight:bold;">Total</td>
          <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${fulfillmentHtml}
    <p style="color: #666;">Questions? WhatsApp us at ${PHONE_NUMBER}.</p>
    ${params.fulfillmentType === 'delivery' ? `<p style="color: #444; background: #FFF8F0; border-left: 3px solid #C6992E; padding: 12px; margin: 16px 0;">UPS doesn&apos;t ship over the weekend, so to ensure your sweets are fresh by the time they&apos;re delivered, we will dispatch your order on <strong>${params.shipWeek ? escapeHtml(shipWeekDays(params.shipWeek)) : 'Monday/Tuesday'}</strong> and share the tracking details. Thanks for understanding.</p>` : ''}
    <p style="color: #666; margin-top: 16px;">Thanks,<br />Team ${BRAND_NAME}</p>
    <p style="color: #bbb; font-size: 11px; margin-top: 24px;">Payment reference: ${params.squarePaymentId}</p>
  `);

  return {
    to: params.email,
    subject: `Order Confirmed — ${params.orderNumber}`,
    html,
    bcc: [...ORDER_CONFIRMATION_BCC],
    dedupeKey: `order-confirmation:${params.orderNumber}`,
  };
}

export async function sendOrderConfirmation(params: OrderConfirmationParams): Promise<{ success: boolean }> {
  return sendEmail(buildOrderConfirmationEmail(params));
}

/**
 * Owner alert — fallback notification for orders where the customer gave no
 * email (so there is no confirmation to BCC the owners on). Sent directly to
 * OWNER_NOTIFICATION_EMAIL; skipped silently when that is not configured.
 */
export interface OwnerOrderAlertParams {
  orderNumber: string;
  total: number;
  subtotal?: number;
  tax?: number;
  shipping?: number;
  maintenanceFee?: number;
  customerName: string;
  phone: string;
  customerEmail: string | null;
  items: Array<{ name: string; quantity: number; price: number; details?: string[] }>;
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  /** Trusted paid-cart classification; older callers fall back to catalog names. */
  picklesOnly?: boolean;
  /** The service label checkout showed (see deliveryServiceLabel); older callers fall back to the method. */
  shippingLabel?: string;
  pickupDate?: string;
  pickupLocation?: string;
  deliveryAddress?: string;
}

export function buildOwnerOrderAlertEmail(params: OwnerOrderAlertParams): EmailOutboxPayload | null {
  const ownerEmails = getOwnerEmails();
  if (ownerEmails.length === 0) return null;

  const picklesOnly = params.picklesOnly ?? containsOnlyPickles(params.items);
  const itemsHtml = params.items
    .map((i) => `<tr><td style="padding:8px 0;">${escapeHtml(i.name)}${itemDetailsHtml(i.details)}</td><td style="text-align:center;">${Number(i.quantity) || 0}</td><td style="text-align:right;">$${(Number(i.price) || 0).toFixed(2)}</td></tr>`)
    .join('');

  const fulfillmentHtml =
    params.fulfillmentType === 'pickup'
      ? `<p style="margin: 2px 0;"><strong>Pickup:</strong> ${escapeHtml(params.pickupDate ? formatPickupDate(params.pickupDate) : '')}${params.pickupLocation ? ` — ${escapeHtml(params.pickupLocation)}` : ''}</p>`
      : `<p style="margin: 2px 0;"><strong>Delivery to:</strong></p><p style="margin: 2px 0; white-space: pre-line; color: #444;">${escapeHtml(params.deliveryAddress || '(no address)')}</p><p style="margin: 6px 0 2px;"><strong>Shipping method:</strong> ${escapeHtml(params.shippingLabel ?? shippingMethodLabel(params.shippingMethod, picklesOnly))}</p>`;

  const html = baseTemplate(`
    <h2 style="color: #7B1F1F;">New Order — ${params.orderNumber}</h2>
    <div style="font-size: 14px; color: #444;">
      <p style="margin: 2px 0;"><strong>Customer:</strong> ${escapeHtml(params.customerName)}</p>
      <p style="margin: 2px 0;"><strong>Phone:</strong> ${escapeHtml(params.phone)}</p>
      ${params.customerEmail ? `<p style="margin: 2px 0;"><strong>Email:</strong> ${escapeHtml(params.customerEmail)}</p>` : ''}
      ${fulfillmentHtml}
    </div>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <thead><tr style="border-bottom: 2px solid #eee;">
        <th style="text-align:left; padding:8px 0;">Item</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Price</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        ${totalsFooterRows({ ...params, picklesOnly })}
        <tr style="border-top: 2px solid #7B1F1F;">
          <td colspan="2" style="padding:12px 0; font-weight:bold;">Total (paid)</td>
          <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  `);

  return {
    to: ownerEmails,
    subject: `🔔 New order ${params.orderNumber} — $${params.total.toFixed(2)} (${params.fulfillmentType})`,
    html,
    dedupeKey: `owner-order-alert:${params.orderNumber}`,
  };
}

export async function sendOwnerOrderAlert(params: OwnerOrderAlertParams): Promise<{ success: boolean }> {
  const email = buildOwnerOrderAlertEmail(params);
  return email ? sendEmail(email) : { success: false };
}

/**
 * Confirmation for a new event / bulk inquiry from the Events page.
 *
 * Sent TO the customer, with the business inbox (amammajaadi@gmail.com) CC'd so
 * the owner is notified on the same message and can call the customer back.
 * The business address in OWNER_NOTIFICATION_EMAIL is used for the visible CC;
 * a personal owner address, if any, is BCC'd so it isn't exposed to customers.
 */
export async function sendEventInquiry(params: {
  inquiryId: string;
  customerEmail: string;
  customerName: string;
  phone: string;
  eventType: string;
  eventDate: string;
  quantity: number;
  sweets: string;
  deliveryAddress: string;
}): Promise<{ success: boolean }> {
  const owners = getOwnerEmails();
  // Visible CC = the public business inbox; hidden BCC = any personal owner
  // address (so a customer never sees the owner's personal email).
  const cc = owners.filter((e) => e.toLowerCase().includes('amammajaadi'));
  const bcc = owners.filter((e) => !cc.includes(e));

  const details = `
    <div style="font-size: 14px; color: #444; background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 12px 0;">
      <p style="margin: 3px 0;"><strong>Name:</strong> ${escapeHtml(params.customerName)}</p>
      <p style="margin: 3px 0;"><strong>Phone:</strong> ${escapeHtml(params.phone)}</p>
      <p style="margin: 3px 0;"><strong>Event:</strong> ${escapeHtml(params.eventType)}</p>
      <p style="margin: 3px 0;"><strong>Date:</strong> ${escapeHtml(formatPickupDate(params.eventDate))}</p>
      <p style="margin: 3px 0;"><strong>Quantity:</strong> ${Number(params.quantity) || 0} pieces</p>
      <p style="margin: 3px 0;"><strong>Sweets:</strong> ${escapeHtml(params.sweets)}</p>
      <p style="margin: 8px 0 3px;"><strong>Delivery address:</strong></p>
      <p style="margin: 0; white-space: pre-line;">${escapeHtml(params.deliveryAddress || '(not provided)')}</p>
    </div>`;

  const html = baseTemplate(`
    <h2 style="color: #1B4332;">Event Inquiry Received</h2>
    <p>Hi ${escapeHtml(params.customerName) || 'there'},<br />Thank you for your event inquiry. Our team will contact you within 24 hours to confirm the details and share pricing. Here's what we received:</p>
    ${details}
    <p style="color: #666;">Questions? WhatsApp us at ${PHONE_NUMBER}.</p>
    <p style="color: #666; margin-top: 16px;">Thanks,<br />Team ${BRAND_NAME}</p>
  `);

  return sendEmail({
    to: params.customerEmail,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: `Event Inquiry Received — ${params.eventType}`,
    html,
    dedupeKey: `event-inquiry:${params.inquiryId}`,
  });
}

/** "Visa ending 9268" from Square's card brand and last four. */
export function refundDestinationLabel(cardBrand?: string, last4?: string): string {
  if (!last4) return 'Your original payment method';
  const brands: Record<string, string> = {
    VISA: 'Visa', MASTERCARD: 'Mastercard', AMERICAN_EXPRESS: 'American Express', DISCOVER: 'Discover',
    DISCOVER_DINERS: 'Diners Club', JCB: 'JCB', CHINA_UNIONPAY: 'UnionPay', SQUARE_GIFT_CARD: 'Gift card',
  };
  const brand = cardBrand ? brands[cardBrand] ?? 'Card' : 'Card';
  return `${brand} ending ${last4}`;
}

/**
 * To the customer as soon as Square reports a refund (the owner's refund
 * template, first sent for AJ-1189). One email per Square refund.
 */
export function buildRefundEmail(params: {
  to: string;
  refundId: string;
  orderNumber: string;
  customerName: string;
  items: Array<{ name: string; selectedTier?: number | null; quantity: number }>;
  amount: number;
  full: boolean;
  refundedTo: string;
  initiatedOn: Date;
}): EmailOutboxPayload {
  const name = escapeHtml(params.customerName.trim()) || 'there';
  const orderNumber = escapeHtml(params.orderNumber);
  const item = params.items
    .map((i) => `${i.name}${i.selectedTier ? ` (${i.selectedTier} pcs)` : ''}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`)
    .join(', ');
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
    .format(params.initiatedOn);
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 8px 0; color: #666;">${label}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${value}</td></tr>`;
  const html = baseTemplate(`
<h2 style="color: #7B1F1F; margin: 0 0 12px;">Your refund has been initiated</h2>
<p style="margin: 0 0 12px;">Hi ${name},</p>
<p style="margin: 0 0 16px; line-height: 1.5;">We have initiated a ${params.full ? 'full refund' : 'partial refund'} for your order <strong>${orderNumber}</strong> from our end.</p>
<table style="width: 100%; border-collapse: collapse; font-size: 14px; border-top: 1px solid #eee; border-bottom: 1px solid #eee; margin: 0 0 16px;">
${row('Order', orderNumber)}
${item ? row('Item', escapeHtml(item)) : ''}
${row('Refund amount', `$${params.amount.toFixed(2)}`)}
${row('Refunded to', escapeHtml(params.refundedTo))}
${row('Refund initiated', date)}
</table>
<p style="margin: 0 0 16px; line-height: 1.5; background: #FFF8F0; border-left: 3px solid #C6992E; padding: 12px;">The refund will usually reflect on your card within <strong>7 business days</strong>, depending on your bank.</p>
<p style="margin: 0 0 16px; line-height: 1.5;">Questions? WhatsApp us at ${PHONE_NUMBER} — we&apos;re happy to help.</p>
<p style="margin: 0;">With love,<br><strong>Team ${BRAND_NAME}</strong></p>
`);
  return {
    to: params.to,
    cc: [...REFUND_EMAIL_CC],
    subject: `Your refund for order ${params.orderNumber} has been initiated`,
    html,
    dedupeKey: `refund:${params.refundId}`,
  };
}

/** 2. Pickup Ready Notification */
export async function sendPickupReady(params: {
  email: string;
  orderNumber: string;
  pickupLocation: string;
  pickupTime: string;
}): Promise<{ success: boolean }> {
  const html = baseTemplate(`
    <h2 style="color: #1B4332;">Your Order is Ready! 🎉</h2>
    <p>Order <strong>#${params.orderNumber}</strong> is ready for pickup.</p>
    <div style="background: #FFF8F0; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 4px 0;"><strong>Location:</strong> ${params.pickupLocation}</p>
      <p style="margin: 4px 0;"><strong>Pickup Time:</strong> ${params.pickupTime}</p>
    </div>
    <p style="color: #666;">Please bring this email or your order number when you arrive.</p>
  `);

  return sendEmail({
    to: params.email,
    subject: `Ready for Pickup — #${params.orderNumber}`,
    html,
    dedupeKey: `pickup-ready:${params.orderNumber}`,
  });
}

/** 3. Delivery/Shipping Confirmation */
export async function sendDeliveryConfirmation(params: {
  email: string;
  orderNumber: string;
  estimatedDelivery: string;
}): Promise<{ success: boolean }> {
  const html = baseTemplate(`
    <h2 style="color: #1B4332;">Your Order is On Its Way! 🚗</h2>
    <p>Order <strong>#${params.orderNumber}</strong> has been dispatched.</p>
    <div style="background: #FFF8F0; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 4px 0;"><strong>Estimated Delivery:</strong> ${params.estimatedDelivery}</p>
    </div>
    <p style="color: #666;">Track your order or contact us via WhatsApp at ${PHONE_NUMBER}.</p>
  `);

  return sendEmail({
    to: params.email,
    subject: `Order Shipped — #${params.orderNumber}`,
    html,
    dedupeKey: `delivery-confirmation:${params.orderNumber}:${params.estimatedDelivery}`,
  });
}

// ─── Project Shippo emails ────────────────────────────────────

/** UPS public tracking page for a tracking number. */
export function upsTrackingUrl(trackingNumber: string): string {
  return `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(trackingNumber)}`;
}

/** To the shop, right after a label is bought: the label link, tracking and the packing list. */
export function buildShippingLabelEmail(params: {
  to: string;
  labelId: string;
  orderNumber: string;
  customerName: string;
  cityState: string;
  serviceName: string;
  amount: number;
  trackingNumber: string | null;
  labelUrl: string | null;
  box: string;
  weightLb: number;
  shipDate: string;
  items: Array<{ name: string; quantity: number }>;
}): EmailOutboxPayload {
  const rows = params.items
    .map((i) => `<tr><td style="padding:6px 0;">${escapeHtml(i.name)}</td><td style="text-align:right;">× ${Number(i.quantity) || 0}</td></tr>`)
    .join('');
  const html = baseTemplate(`
    <h2 style="color: #7B1F1F; margin-top: 0;">Label ready: ${escapeHtml(params.orderNumber)}</h2>
    <p style="margin: 0 0 12px;">${escapeHtml(params.customerName)} · ${escapeHtml(params.cityState)}</p>
    ${params.labelUrl ? `<p style="margin: 16px 0;"><a href="${escapeHtml(params.labelUrl)}" style="background:#7B1F1F; color:#fff; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:bold;">Download 4×6 label (PDF)</a></p>` : ''}
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 4px 0;"><strong>Service:</strong> ${escapeHtml(params.serviceName)} · $${params.amount.toFixed(2)}</p>
      <p style="margin: 4px 0;"><strong>Tracking:</strong> ${params.trackingNumber ? escapeHtml(params.trackingNumber) : '—'}</p>
      <p style="margin: 4px 0;"><strong>Box:</strong> ${escapeHtml(params.box)} in · ${params.weightLb} lb packed</p>
      <p style="margin: 4px 0;"><strong>Ship date:</strong> ${escapeHtml(params.shipDate)}</p>
    </div>
    <h3 style="margin: 16px 0 6px;">Packing list</h3>
    <table style="width:100%; border-collapse: collapse;">${rows}</table>
  `);
  return {
    to: params.to,
    subject: `${params.orderNumber} · ${params.serviceName} · ${params.cityState}`,
    html,
    dedupeKey: `shipping-label:${params.labelId}`,
  };
}

/** To the shop every night: delivery orders still waiting for a label or a Pirate Ship tracking number. */
export function buildShippingWaitingEmail(params: {
  to: string;
  date: string;
  waiting: Array<{ orderNumber: string; customerName: string; cityState: string; route: string; orderedOn: string }>;
}): EmailOutboxPayload {
  const rows = params.waiting
    .map((o) => `<tr><td style="padding:6px 0;"><strong>${escapeHtml(o.orderNumber)}</strong></td><td>${escapeHtml(o.customerName)}</td><td>${escapeHtml(o.cityState)}</td><td>${escapeHtml(o.route)}</td><td>${escapeHtml(o.orderedOn)}</td></tr>`)
    .join('');
  const html = baseTemplate(params.waiting.length === 0
    ? `<h2 style="color: #1B4332; margin-top: 0;">All orders have labels ✅</h2><p>No delivery orders are waiting for a label tonight.</p>`
    : `<h2 style="color: #7B1F1F; margin-top: 0;">${params.waiting.length} delivery ${params.waiting.length === 1 ? 'order is' : 'orders are'} waiting</h2>
       <p>These paid delivery orders have no label (Shippo) or tracking number (Pirate Ship) yet.</p>
       <table style="width:100%; border-collapse: collapse; font-size: 14px;">
         <tr style="text-align:left; color:#666;"><th>Order</th><th>Customer</th><th>To</th><th>Ship by</th><th>Ordered</th></tr>${rows}
       </table>`);
  return {
    to: params.to,
    subject: params.waiting.length === 0 ? `All orders have labels · ${params.date}` : `${params.waiting.length} delivery orders waiting · ${params.date}`,
    html,
    dedupeKey: `shipping-waiting:${params.date}`,
  };
}

/** Where a tracking number can be followed: UPS (1Z…), USPS (Pirate Ship), or unknown. */
function trackingCarrier(trackingNumber: string): { name: string; url: string } | null {
  const n = trackingNumber.trim();
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return { name: 'UPS', url: upsTrackingUrl(n) };
  if (/^9\d{19,21}$/.test(n)) {
    return { name: 'USPS', url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` };
  }
  return null;
}

/**
 * To the customer, once, after UPS has their box: the owner's approved
 * "Your order is on its way!" email (2026-09-02 template), with the UPS card
 * and button. Non-UPS numbers get the same email without UPS branding.
 */
export function buildTrackingEmail(params: {
  to: string;
  cc?: string[];
  orderId: string;
  orderNumber: string;
  customerName: string;
  trackingNumber: string;
  delivered?: boolean;
}): EmailOutboxPayload {
  const trackingNumber = params.trackingNumber.trim();
  const carrier = trackingCarrier(trackingNumber);
  const ups = carrier?.name === 'UPS';
  const name = escapeHtml(params.customerName.trim()) || 'there';
  const orderNumber = escapeHtml(params.orderNumber);
  const status = params.delivered ? 'Delivered' : 'In transit';
  const p = 'margin:0 0 12px;font-size:16px;line-height:1.65;';
  const label = 'margin-top:10px;font-size:14px;color:#75665c;';
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2d2926;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${BRAND_NAME} order tracking details are ready.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f1ec;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 3px 14px rgba(69,45,26,.10);">
<tr><td align="center" style="padding:22px 20px;border-bottom:2px solid #7b1f1f;">
<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr>
<td valign="middle" style="padding-right:14px;"><img src="${SITE_URL}/images/brand/email-logo.png" alt="${BRAND_NAME}" width="68" height="68" style="display:block;width:68px;height:68px;border-radius:50%;border:0;"></td>
<td valign="middle" align="left"><div style="color:#7b1f1f;font-size:29px;font-weight:bold;line-height:1.1;">${BRAND_NAME}</div><div style="margin-top:4px;color:#c6992e;font-size:13px;letter-spacing:2.3px;">FLAVORS OF HOME</div></td>
</tr></table></td></tr>
<tr><td style="padding:34px 40px 8px;">
<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#c6992e;font-weight:bold;margin-bottom:12px;">Shipping confirmation</div>
<h1 style="margin:0 0 20px;font-size:29px;line-height:1.2;color:#1b4332;">Your order is on its way!</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.65;">Hi ${name},</p>
<p style="${p}">Your order has been packed and dispatched${carrier ? ` via ${carrier.name}` : ''} to your destination.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.65;">${params.delivered
    ? `${carrier ? carrier.name : 'The carrier'} shows your package as delivered. Please use the tracking link below for the delivery details.`
    : 'Your package is currently in transit. Please use the tracking link below for the latest delivery estimate.'}</p>
</td></tr>
<tr><td style="padding:0 40px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fff8f0;border:1px solid #eadbc9;border-radius:8px;"><tr>
${ups ? `<td width="106" align="center" valign="middle" style="padding:22px 10px 22px 20px;"><img src="${SITE_URL}/images/email/ups-logo.png" width="72" height="72" alt="UPS" style="display:block;width:72px;height:72px;border:0;"></td>\n` : ''}<td valign="middle" style="padding:22px 22px 22px ${ups ? '8px' : '22px'};">
<div style="font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#75665c;">${carrier ? `${carrier.name} shipment` : 'Shipment'}</div>
<div style="${label}">Order ID</div>
<div style="font-size:18px;line-height:1.4;color:#7b1f1f;font-weight:bold;">${orderNumber}</div>
<div style="${label}">Tracking number</div>
<div style="font-size:18px;line-height:1.4;color:#1b4332;font-weight:bold;word-break:break-all;">${escapeHtml(trackingNumber)}</div>
<div style="${label}">Current status</div>
<div style="font-size:17px;line-height:1.4;color:#7b1f1f;font-weight:bold;">${status}</div>
</td></tr></table></td></tr>
${carrier ? `<tr><td align="center" style="padding:26px 40px 18px;"><a href="${escapeHtml(carrier.url)}" style="display:inline-block;background:#351c15;color:#ffbf27;text-decoration:none;font-size:16px;font-weight:bold;padding:15px 32px;border-radius:7px;">Track Package with ${carrier.name}</a></td></tr>` : '<tr><td style="padding:18px 40px 0;"></td></tr>'}
<tr><td style="padding:4px 40px 32px;">
<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#6b625d;">${carrier ? `${carrier.name} tracking` : 'Tracking'} will show the latest movement and estimated delivery date.</p>
<p style="margin:0;font-size:16px;line-height:1.65;">Thank you for choosing ${BRAND_NAME}. We hope you enjoy every bite!</p>
<p style="margin:20px 0 0;font-size:16px;line-height:1.6;">Thanks,<br><strong style="color:#7b1f1f;">Team ${BRAND_NAME}</strong></p>
</td></tr>
<tr><td align="center" style="border-top:1px solid #eee;padding:18px 24px;color:#999999;"><div style="font-size:12px;line-height:1.6;">${BRAND_NAME} · Dallas, TX · <a href="https://www.amammajaadi.com" style="color:#7b1f1f;">www.AmammaJaadi.com</a></div></td></tr>
</table></td></tr></table></body></html>`;
  return {
    to: params.to,
    ...(params.cc?.length ? { cc: params.cc } : {}),
    subject: `${BRAND_NAME}: ${params.orderNumber} Your Order is on its way`,
    html,
    dedupeKey: `tracking:${params.orderId}:${params.trackingNumber}`,
  };
}
