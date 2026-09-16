import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getSquarePublicConfig } from '@/lib/square';
import { getTaxReport, quarterRange, taxReportCsv } from '@/lib/tax-report';
import { saveRefundAllocation, type RefundAllocation } from '@/lib/tax-refunds';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
async function authenticated() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return Boolean(session && verifySessionToken(session));
}

export async function GET(request: Request) {
  if (!(await authenticated())) return json({ error: 'Unauthorized' }, 401);
  const params = new URL(request.url).searchParams;
  const year = Number(params.get('year')), quarter = Number(params.get('quarter'));
  try { quarterRange(year, quarter); } catch { return json({ error: 'Choose a valid year and quarter.' }, 400); }
  const view = params.get('view') ?? 'transactions';
  if (!['transactions', 'items', 'summary', 'refund-history'].includes(view)) return json({ error: 'Invalid export.' }, 400);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);
  try {
    const report = await getTaxReport(getDb(), year, quarter, getSquarePublicConfig().environment);
    if (params.get('format') === 'csv') {
      return new Response(taxReportCsv(report, view as 'transactions' | 'items' | 'summary' | 'refund-history'), {
        headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="amamma-jaadi-${report.environment}-${year}-Q${quarter}-${view}.csv"` },
      });
    }
    return json(report);
  } catch {
    console.error('Quarterly tax report could not be loaded');
    return json({ error: 'Could not load the tax report. No partial report was returned.' }, 500);
  }
}

/** Records the accounting allocation only. This endpoint never issues a refund. */
export async function POST(request: Request) {
  if (!(await authenticated())) return json({ error: 'Unauthorized' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);
  let input: RefundAllocation;
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
    input = value;
  } catch { return json({ error: 'Invalid refund allocation.' }, 400); }
  try {
    if (!(await saveRefundAllocation(getDb(), input))) {
      return json({ error: 'Amounts must match the refund and stay within the original receipt, including other refunds. Historical orders without a breakdown need reconciliation outside this form.' }, 409);
    }
    return json({ saved: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Enter valid')) return json({ error: error.message }, 400);
    console.error('Refund allocation could not be saved');
    return json({ error: 'Could not save the refund allocation.' }, 500);
  }
}
