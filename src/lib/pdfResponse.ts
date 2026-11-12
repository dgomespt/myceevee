import { createHash } from 'node:crypto';
import { avatar } from './avatar';
import type { CvKey } from './config';
import { safeUrl } from './format';
import type { LoadResult } from './gist';
import { pdfFileName, renderResumePdf } from './pdf';

/** A short plain-text reply for the PDF routes, which have no page to show. */
export function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Finished PDFs keyed by a hash of everything they were built from, so a changed gist is picked up straight away and a
// burst of downloads doesn't re-render each time. A few entries are plenty for one person's two CVs.
const CACHE_MAX = 8;
const cache = new Map<string, Buffer>();

/** The PDF for an already-authorised CV (the caller has checked it is public, or that the short link is live). */
export async function cvPdfResponse(cvKey: CvKey, result: LoadResult): Promise<Response> {
  if (!result.ok) return plain(503, "This CV can't be shown right now. Please try again shortly.");
  const { resume, order } = result;
  try {
    // Same choice as the web CV: an explicit basics.image wins, otherwise the Gravatar for basics.email. The web page lets
    // the visitor's browser load basics.image; here the server has to, and it never fetches arbitrary addresses taken
    // from gist content, so getUrl only accepts Gravatar addresses. Any other host means no photo in the PDF.
    const image = safeUrl(resume.basics?.image);
    const photo = image ? await avatar.getUrl(image) : await avatar.get(resume.basics?.email);
    const key = createHash('sha256').update(JSON.stringify([cvKey, order, resume, photo])).digest('hex');
    let pdf = cache.get(key);
    if (!pdf) {
      pdf = await renderResumePdf(resume, { variant: cvKey, order, photo });
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, pdf);
    }
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        // "inline" lets a pasted link open in the browser's viewer; the page's button forces a download itself.
        'Content-Disposition': `inline; filename="${pdfFileName(resume.basics?.name, cvKey)}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error(`[myceevee] could not build the ${cvKey} PDF:`, err);
    return plain(500, 'The PDF could not be created. Please try again shortly.');
  }
}
