import type { APIRoute } from 'astro';
import { revokeAllSessions } from '../../lib/adminSession';
import { SESSION_COOKIE } from '../../lib/auth';
import { getDb } from '../../lib/db';

/** Signing out ends every admin session, not just this browser's cookie, so a copied cookie stops working. */
export const POST: APIRoute = ({ cookies, redirect }) => {
  revokeAllSessions(getDb());
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/admin/login', 303);
};
