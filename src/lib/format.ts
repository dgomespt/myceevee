const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2020-03-14" | "2020-03" | "2020" -> "Mar 2020" | "Mar 2020" | "2020". Unparseable input is returned as-is. */
export function formatDate(d?: string): string {
  if (!d) return '';
  const m = /^(\d{4})(?:-(\d{2}))?(?:-\d{2})?$/.exec(d);
  if (!m) return d;
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  return month ? `${month} ${m[1]}` : m[1]!;
}

/** "Mar 2020 – Present", "2019 – 2021", or a single date. Empty if neither is set. */
export function dateRange(start?: string, end?: string): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e) return s === e ? s : `${s} – ${e}`;
  if (s) return `${s} – Present`;
  return e;
}

/** Gist content is untrusted: only allow http(s) links so `javascript:` and friends are never rendered. */
export function safeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

export function locationLine(loc?: { city?: string; region?: string; countryCode?: string }): string {
  return [loc?.city, loc?.region, loc?.countryCode].filter(Boolean).join(', ');
}

export type IconName = 'github' | 'linkedin' | 'email' | 'web' | 'copy' | 'check' | 'close' | 'refresh' | 'download' | 'map-pin';

/** Picks a brand icon for a JSON Resume profile, by network name or, failing that, by the link's host. */
export function profileIcon(p: { network?: string; url?: string }): 'github' | 'linkedin' | null {
  const net = (p.network ?? '').trim().toLowerCase();
  if (net === 'github') return 'github';
  if (net === 'linkedin') return 'linkedin';
  let host = '';
  try { host = new URL(p.url ?? '').hostname.toLowerCase(); } catch { /* no usable url */ }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  return null;
}
