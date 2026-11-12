import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { loadCv } from '../../lib/gist';
import { resolveLinkDetail } from '../../lib/links';
import { trackView } from '../../lib/metrics';
import { cvPdfResponse, plain } from '../../lib/pdfResponse';
import { clientKey, linkLimiter } from '../../lib/ratelimit';

// The PDF behind a short link (/s/<token>.pdf). It follows the link's rules exactly: the same rate limit as the page, and an
// expired, revoked or unknown link all get the same answer, so nothing reveals whether a link ever existed.
// (src/middleware.ts adds the noindex / no-store / no-referrer headers to everything under /s.)
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  if (!linkLimiter.allow(clientKey(request, clientAddress))) return plain(429, 'Too many requests. Please wait a minute and try again.');
  const link = params.token ? resolveLinkDetail(getDb(), params.token) : null;
  if (!link) return plain(410, 'This link has expired or is no longer available.');
  const { result } = await loadCv(link.cvKey);
  const response = await cvPdfResponse(link.cvKey, result);
  if (response.status === 200) trackView(getDb(), { cvKey: link.cvKey, kind: 'pdf', link, request, clientAddress });
  return response;
};
