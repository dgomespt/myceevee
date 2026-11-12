import type { APIRoute } from 'astro';
import { isCvKey } from '../../lib/config';
import { getDb } from '../../lib/db';
import { loadCv } from '../../lib/gist';
import { isPublic } from '../../lib/links';
import { trackView } from '../../lib/metrics';
import { cvPdfResponse, plain } from '../../lib/pdfResponse';

// The PDF of a public CV, at the page's address plus ".pdf" (/cv/full.pdf). A private CV is a 404, exactly like its page.
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  const { key } = params;
  if (!isCvKey(key) || !isPublic(getDb(), key)) return plain(404, 'Not found');
  const { result } = await loadCv(key);
  const response = await cvPdfResponse(key, result);
  if (response.status === 200) trackView(getDb(), { cvKey: key, kind: 'pdf', request, clientAddress });
  return response;
};
