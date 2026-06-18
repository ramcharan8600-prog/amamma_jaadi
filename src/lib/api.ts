import { NextResponse } from 'next/server';

/**
 * Uniform JSON response helpers for route handlers.
 * Keeps success/error shapes consistent and centralizes server-error logging.
 */

/** Success response with arbitrary JSON body. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Error response with `{ error: message }`. Logs 5xx automatically. */
export function fail(message: string, status = 400): NextResponse {
  if (status >= 500) console.error(`[api ${status}] ${message}`);
  return NextResponse.json({ error: message }, { status });
}
