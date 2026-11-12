import type { APIRoute } from 'astro';
import { metricsTokenProblem, safeEqual } from '../lib/auth';
import { config } from '../lib/config';
import { getDb } from '../lib/db';
import { renderMetrics } from '../lib/metrics';
import { clientKey, metricsFailures } from '../lib/ratelimit';
import { plain } from '../lib/pdfResponse';

let warned = false;

// Prometheus scrape endpoint. Off (404, as if it did not exist) until METRICS_TOKEN is set to a strong value, then it needs
// `Authorization: Bearer <token>`. It exposes link labels, so it must never be reachable without the token.
// (src/middleware.ts adds the noindex / no-store headers.)
export const GET: APIRoute = ({ request, clientAddress }) => {
  const problem = metricsTokenProblem();
  if (problem) {
    if (config.metricsToken && !warned) {
      warned = true;
      console.warn(`[myceevee] /metrics stays off: ${problem}`);
    }
    return plain(404, 'Not found');
  }

  const who = clientKey(request, clientAddress);
  if (metricsFailures.isLocked(who)) {
    return new Response('Too many failed attempts. Try again later.', {
      status: 429,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(metricsFailures.retryAfter(who)) },
    });
  }

  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match || !safeEqual(match[1]!, config.metricsToken)) {
    metricsFailures.recordFailure(who);
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Bearer' },
    });
  }
  metricsFailures.reset(who);

  return new Response(renderMetrics(getDb()), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
};
