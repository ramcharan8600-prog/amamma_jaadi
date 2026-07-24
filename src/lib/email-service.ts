/**
 * Email Service — Resend API
 *
 * Architecture for transactional emails.
 * Currently stubbed — activate by setting RESEND_API_KEY.
 *
 * Supported email types:
 * 1. Order confirmation
 * 2. Pickup ready notification
 * 3. Delivery/shipping confirmation
 *
 * Setup: https://resend.com → Get API key → Set RESEND_API_KEY in .env.local
 */

import { BRAND_NAME, PHONE_NUMBER, SITE_URL, WHATSAPP_NUMBER } from '@/lib/constants';

// Read at REQUEST time — on Cloudflare/OpenNext runtime secrets aren't populated
// at module load, so a module-scope read would be empty even when set.
function getResendKey(): string {
  return process.env.RESEND_API_KEY || '';
}
function getFromEmail(): string {
  return process.env.FROM_EMAIL || 'orders@amammajaadi.com';
}
/**
 * Owner inboxes for new-order notifications (comma-separated env value).
 * BCC'd on customer confirmations; used directly when the customer gave no email.
 */
function getOwnerEmails(): string[] {
  return (process.env.OWNER_NOTIFICATION_EMAIL || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

export function isEmailConfigured(): boolean {
  return !!getResendKey();
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
  /** Hidden recipients — not visible to the primary recipient. */
  bcc?: string[];
}

/** Send an email via Resend API */
async function sendEmail(params: EmailParams): Promise<{ success: boolean; id?: string }> {
  if (!isEmailConfigured()) {
    console.log(`[EMAIL STUB] To: ${params.to} | Subject: ${params.subject}`);
    return { success: false };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getResendKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${BRAND_NAME} <${getFromEmail()}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.bcc && params.bcc.length > 0 ? { bcc: params.bcc } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('Resend API error:', err);
      return { success: false };
    }

    const data = await res.json();
    return { success: true, id: data.id };
  } catch (e) {
    console.error('Email send error:', e);
    return { success: false };
  }
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

/** 1. Order Confirmation */
export async function sendOrderConfirmation(params: {
  email: string;
  orderNumber: string;
  squarePaymentId: string;
  customerName: string;
  phone: string;
  total: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  fulfillmentType: 'pickup' | 'delivery';
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
      ${params.pickupLocation ? `<p style="margin: 0 0 6px; color: #444;">${escapeHtml(params.pickupLocation)}</p>` : ''}
      <p style="margin: 0; color: #666;">You can pick up your order between <strong>6:30 PM and 1:30 AM</strong> at the selected location.</p>
    </div>`
      : `
    <div style="background: #FFF8F0; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; font-weight: bold; color: #7B1F1F;">Delivery</p>
      ${params.deliveryAddress ? `<p style="margin: 0 0 6px; color: #444; white-space: pre-line;">${escapeHtml(params.deliveryAddress)}</p>` : ''}
      <p style="margin: 0; color: #666;">We&apos;ll share tracking details for your delivery shortly.</p>
    </div>`;

  const html = baseTemplate(`
    <h2 style="color: #1B4332;">Order Confirmed!</h2>
    <p>Hi ${escapeHtml(params.customerName) || 'there'}, thank you for your order. Here are the details:</p>
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
      <tfoot><tr style="border-top: 2px solid #7B1F1F;">
        <td colspan="2" style="padding:12px 0; font-weight:bold;">Total</td>
        <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
      </tr></tfoot>
    </table>
    ${fulfillmentHtml}
    <p style="color: #666;">Questions? WhatsApp us at ${PHONE_NUMBER}.</p>
    <p style="color: #bbb; font-size: 11px; margin-top: 24px;">Payment reference: ${params.squarePaymentId}</p>
  `);

  return sendEmail({
    to: params.email,
    subject: `Order Confirmed — ${params.orderNumber}`,
    html,
    // Owners get a hidden copy of every confirmation — one send, no extra
    // quota, invisible to the customer.
    bcc: getOwnerEmails(),
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
  customerName: string;
  phone: string;
  customerEmail: string | null;
  items: Array<{ name: string; quantity: number; price: number }>;
  fulfillmentType: 'pickup' | 'delivery';
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
      ? `<p style="margin: 2px 0;"><strong>Pickup:</strong> ${escapeHtml(params.pickupDate || '')}${params.pickupLocation ? ` — ${escapeHtml(params.pickupLocation)}` : ''}</p>`
      : `<p style="margin: 2px 0;"><strong>Delivery to:</strong></p><p style="margin: 2px 0; white-space: pre-line; color: #444;">${escapeHtml(params.deliveryAddress || '(no address)')}</p>`;

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
      <tfoot><tr style="border-top: 2px solid #7B1F1F;">
        <td colspan="2" style="padding:12px 0; font-weight:bold;">Total (paid)</td>
        <td style="text-align:right; font-weight:bold; color:#7B1F1F;">$${params.total.toFixed(2)}</td>
      </tr></tfoot>
    </table>
  `);

  return sendEmail({
    to: ownerEmails,
    subject: `🔔 New order ${params.orderNumber} — $${params.total.toFixed(2)} (${params.fulfillmentType})`,
    html,
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
  });
}
