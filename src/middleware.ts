import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, isAdminSession } from './lib/adminSession';

const startsWithPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const isAdmin = startsWithPath(pathname, '/admin');
  const isShortLink = startsWithPath(pathname, '/s');

  const needsLogin = isAdmin && pathname !== '/admin/login' && !isAdminSession(context.cookies.get(SESSION_COOKIE)?.value);
  const response = needsLogin ? context.redirect('/admin/login', 303) : await next();

  // Short links and admin pages must never be indexed, cached or leak the URL via Referer.
  // Set here rather than in a layout: Astro streams, so headers set during render may be too late.
  if (isAdmin || isShortLink) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Cache-Control', 'no-store');
  }
  // The admin area must never be embedded in another site's frame (clickjacking).
  if (isAdmin) {
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  }
  return response;
});
