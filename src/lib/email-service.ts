/**
 * Transactional email templates backed by the durable D1/Queue outbox.
 *
 * Supported email types:
 * 1. Order confirmation
 * 2. Pickup ready notification
 * 3. Delivery/shipping confirmation
 *
 * Resend delivery happens asynchronously in the custom Worker Queue consumer.
 */

import { BRAND_NAME, PHONE_NUMBER, SITE_URL, WHATSAPP_NUMBER } from '@/lib/constants';
import { formatPickupDate } from '@/lib/date';
import { SALES_TAX_LABEL, shippingMethodLabel } from '@/lib/pricing';
import { enqueueEmail, isEmailOutboxConfigured } from '@/lib/email-outbox';
import type { DeliveryShippingMethod } from '@/types';

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

/** Only the public business inbox receives customer order-confirmation copies. */
function getOrderConfirmationBcc(): string[] {
  const excluded = new Set(['ramcharan8600@gmail.com', 'smallogi5@gmail.com']);
  return (process.env.ORDER_CONFIRMATION_BCC_EMAIL || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email && !excluded.has(email));
}

export function isEmailConfigured(): boolean {
  // Accept mail into D1 even while Resend itself is unavailable or over quota.
  return isEmailOutboxConfigured();
}

/** Escape user-influenced values before interpolating into email HTML. */
function escapeHtml(value: unknown): string {
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

function baseTemplate(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #2D2926;">
      <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #7B1F1F;">
        <table align="center" style="margin: 0 auto;">
          <tr>
            <td style="vertical-align: middle; padding-right: 12px;">
              <img src="${SITE_URL}/images/brand/email-logo.png" alt="${BRAND_NAME}" width="52" height="52" style="display: block; border-radius: 50%;" />
            </td>
            <td style="vertical-align: middle; text-align: left;">
              <div style="color: #7B1F1F; font-size: 24px; font-weight: bold; line-height: 1.1;">${BRAND_NAME}</div>
              <div style="color: #C6992E; font-size: 12px; letter-spacing: 2px;">FLAVORS OF HOME</div>
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
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
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
      `<tr><td colspan="2" style="${cell}">${escapeHtml(shippingMethodLabel(params.shippingMethod))}</td>
       <td style="text-align:right; ${cell}">${fee}</td></tr>`
    );
  }

  // Breathing room before the Total rule.
  return rows.join('') + '<tr><td colspan="3" style="padding-bottom:8px;"></td></tr>';
}

/** 1. Order Confirmation */
export async function sendOrderConfirmation(params: {
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
  items: Array<{ name: string; quantity: number; price: number }>;
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  /** Pickup date (YYYY-MM-DD) — shown for pickup orders. */
  pickupDate?: string;
  /** Pickup location (name + address) — shown for pickup orders. */
  pickupLocation?: string;
  /** Delivery address — shown for delivery orders. */
  deliveryAddress?: string;
}): Promise<{ success: boolean }> {
  const itemsHtml = params.items
    .map((i) => `<tr><td style="padding:8px 0;">${escapeHtml(i.name)}</td><td style="text-align:center;">${Number(i.quantity) || 0}</td><td style="text-align:right;">$${(Number(i.price) || 0).toFixed(2)}</td></tr>`)
    .join('');

  const fulfillmentHtml =
    params.fulfillmentType === 'pickup'
      ? `
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; font-weight: bold; color: #7B1F1F;">Pickup</p>
      ${params.pickupDate ? `<p style="margin: 0 0 6px; color: #2D2926; font-size: 16px;"><strong>Date:</strong> <strong style="color: #7B1F1F;">${escapeHtml(formatPickupDate(params.pickupDate))}</strong></p>` : ''}
      ${params.pickupLocation ? `<p style="margin: 0 0 6px; color: #444;">${escapeHtml(params.pickupLocation)}</p>` : ''}
      <p style="margin: 0; color: #666;">You can pick up your order between <strong>6:30 PM and 1:30 AM</strong> at the selected location.</p>
    </div>`
      : `
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; font-weight: bold; color: #7B1F1F;">Delivery</p>
      ${params.deliveryAddress ? `<p style="margin: 0 0 6px; color: #444; white-space: pre-line;">${escapeHtml(params.deliveryAddress)}</p>` : ''}
      <p style="margin: 0 0 6px; color: #444;"><strong>Method:</strong> ${escapeHtml(shippingMethodLabel(params.shippingMethod))}</p>
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
        ${totalsFooterRows(params)}
        <tr style="border-top: 2px solid #7B1F1F;">
          <td colspan="2" style="padding:12px 0; font-weight:bold;">Total</td>
          <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${fulfillmentHtml}
    <p style="color: #666;">Questions? WhatsApp us at ${PHONE_NUMBER}.</p>
    <p style="color: #666; margin-top: 16px;">Thanks,<br />Team ${BRAND_NAME}</p>
    <p style="color: #bbb; font-size: 11px; margin-top: 24px;">Payment reference: ${params.squarePaymentId}</p>
  `);

  return sendEmail({
    to: params.email,
    subject: `Order Confirmed — ${params.orderNumber}`,
    html,
    // A BCC is a separate Resend quota unit. Only the public business inbox is
    // retained; personal owner addresses are intentionally excluded.
    bcc: getOrderConfirmationBcc(),
    dedupeKey: `order-confirmation:${params.orderNumber}`,
  });
}

/**
 * Owner alert — fallback notification for orders where the customer gave no
 * email (so there is no confirmation to BCC the owners on). Sent directly to
 * OWNER_NOTIFICATION_EMAIL; skipped silently when that is not configured.
 */
export async function sendOwnerOrderAlert(params: {
  orderNumber: string;
  total: number;
  subtotal?: number;
  tax?: number;
  shipping?: number;
  customerName: string;
  phone: string;
  customerEmail: string | null;
  items: Array<{ name: string; quantity: number; price: number }>;
  fulfillmentType: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  pickupDate?: string;
  pickupLocation?: string;
  deliveryAddress?: string;
}): Promise<{ success: boolean }> {
  const ownerEmails = getOwnerEmails();
  if (ownerEmails.length === 0) return { success: false };

  const itemsHtml = params.items
    .map((i) => `<tr><td style="padding:8px 0;">${escapeHtml(i.name)}</td><td style="text-align:center;">${Number(i.quantity) || 0}</td><td style="text-align:right;">$${(Number(i.price) || 0).toFixed(2)}</td></tr>`)
    .join('');

  const fulfillmentHtml =
    params.fulfillmentType === 'pickup'
      ? `<p style="margin: 2px 0;"><strong>Pickup:</strong> ${escapeHtml(params.pickupDate ? formatPickupDate(params.pickupDate) : '')}${params.pickupLocation ? ` — ${escapeHtml(params.pickupLocation)}` : ''}</p>`
      : `<p style="margin: 2px 0;"><strong>Delivery to:</strong></p><p style="margin: 2px 0; white-space: pre-line; color: #444;">${escapeHtml(params.deliveryAddress || '(no address)')}</p><p style="margin: 6px 0 2px;"><strong>Shipping method:</strong> ${escapeHtml(shippingMethodLabel(params.shippingMethod))}</p>`;

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
        ${
          params.tax != null && params.subtotal != null
            ? `<tr><td colspan="2" style="padding:10px 0 2px; color:#666;">Subtotal</td>
               <td style="text-align:right; padding:10px 0 2px; color:#666;">$${Number(params.subtotal).toFixed(2)}</td></tr>
               <tr><td colspan="2" style="padding:2px 0; color:#666;">${SALES_TAX_LABEL}</td>
               <td style="text-align:right; padding:2px 0; color:#666;">$${Number(params.tax).toFixed(2)}</td></tr>
               ${
                 params.fulfillmentType === 'delivery'
                   ? `<tr><td colspan="2" style="padding:2px 0 10px; color:#666;">${escapeHtml(shippingMethodLabel(params.shippingMethod))}</td>
                      <td style="text-align:right; padding:2px 0 10px; color:#666;">${Number(params.shipping) > 0 ? `$${Number(params.shipping).toFixed(2)}` : 'Free'}</td></tr>`
                   : ''
               }`
            : ''
        }
        <tr style="border-top: 2px solid #7B1F1F;">
          <td colspan="2" style="padding:12px 0; font-weight:bold;">Total (paid)</td>
          <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  `);

  return sendEmail({
    to: ownerEmails,
    subject: `🔔 New order ${params.orderNumber} — $${params.total.toFixed(2)} (${params.fulfillmentType})`,
    html,
    dedupeKey: `owner-order-alert:${params.orderNumber}`,
  });
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
