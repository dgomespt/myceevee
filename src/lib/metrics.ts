import { createHmac, randomBytes } from 'node:crypto';
import { CV_KEYS, config, type CvKey } from './config';
import type { Db } from './db';
import { clientKey } from './ratelimit';

export type ViewKind = 'page' | 'pdf';
export const VIEW_KINDS: readonly ViewKind[] = ['page', 'pdf'] as const;

const DAY_MS = 86_400_000;
export const UNTITLED = 'Untitled';

/** UTC calendar day, "2026-11-12". */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ---- visitors ---------------------------------------------------------------

// Used when SESSION_SECRET is not set: uniques are then only stable until the process restarts, which is fine.
const processSecret = randomBytes(32);

/**
 * An anonymous visitor id that is only comparable within one UTC day. The key is derived from the day, so tomorrow the same
 * person gets a different id and nobody can be followed across days. Neither the IP address nor the user agent is stored.
 */
export function visitorId(ip: string, userAgent: string, now: number, secret: string | Buffer = config.sessionSecret || processSecret): string {
  const dayKey = createHmac('sha256', secret).update(`visitors:${dayOf(now)}`).digest();
  return createHmac('sha256', dayKey).update(`${ip}\n${userAgent}`).digest('hex').slice(0, 16);
}

// ---- recording --------------------------------------------------------------

export type ViewInput =
  | { cvKey: CvKey; kind: ViewKind; link?: undefined; visitor: string }
  | { cvKey: CvKey; kind: ViewKind; link: { tokenHash: string; label: string | null }; visitor?: undefined };

/** Counts one served view. A public CV view also marks its visitor as seen today; a short-link view is counted by link only. */
export function recordView(db: Db, view: ViewInput, now = Date.now()): void {
  const linkHash = view.link?.tokenHash ?? '';
  const label = view.link ? (view.link.label ?? '') : '';
  db.transaction(() => {
    db.prepare(
      `INSERT INTO view_totals (cv_key, kind, link_hash, label, views, last_viewed_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(cv_key, kind, link_hash) DO UPDATE SET views = views + 1, last_viewed_at = excluded.last_viewed_at`,
    ).run(view.cvKey, view.kind, linkHash, label, now);
    if (!view.link) {
      db.prepare('INSERT OR IGNORE INTO visitors_daily (day, cv_key, visitor) VALUES (?, ?, ?)').run(dayOf(now), view.cvKey, view.visitor);
    }
  })();
}

export function pruneVisitors(db: Db, retentionDays: number, now = Date.now()): void {
  db.prepare('DELETE FROM visitors_daily WHERE day < ?').run(dayOf(now - retentionDays * DAY_MS));
}

let lastPruned = 0;

/**
 * What the CV routes call after they have served a CV. It can never break the page: any failure is logged and swallowed.
 * Only GET is counted, so HEAD requests (link checkers, some previews) are ignored. Link-preview bots that fetch a short link
 * do count as a view, as they are indistinguishable from a person.
 */
export function trackView(
  db: Db,
  input: { cvKey: CvKey; kind: ViewKind; link?: { tokenHash: string; label: string | null }; request: Request; clientAddress: string },
  now = Date.now(),
): void {
  if (input.request.method !== 'GET') return;
  try {
    const { cvKey, kind } = input;
    if (input.link) {
      recordView(db, { cvKey, kind, link: input.link }, now);
    } else {
      const ip = clientKey(input.request, input.clientAddress);
      recordView(db, { cvKey, kind, visitor: visitorId(ip, input.request.headers.get('user-agent') ?? '', now) }, now);
    }
    if (now - lastPruned > 3600_000) {
      lastPruned = now;
      pruneVisitors(db, config.metricsRetentionDays, now);
    }
  } catch (err) {
    console.warn('[myceevee] could not record a view:', err instanceof Error ? err.message : err);
  }
}

// ---- reading ----------------------------------------------------------------

export interface LinkViews { pages: number; pdfs: number; lastViewedAt: number | null }

/** Views per link, keyed by token hash (what /admin lists). */
export function linkViewCounts(db: Db): Map<string, LinkViews> {
  const rows = db
    .prepare("SELECT link_hash, kind, views, last_viewed_at FROM view_totals WHERE link_hash <> ''")
    .all() as { link_hash: string; kind: ViewKind; views: number; last_viewed_at: number }[];
  const out = new Map<string, LinkViews>();
  for (const r of rows) {
    const v = out.get(r.link_hash) ?? { pages: 0, pdfs: 0, lastViewedAt: null };
    if (r.kind === 'pdf') v.pdfs += r.views; else v.pages += r.views;
    v.lastViewedAt = Math.max(v.lastViewedAt ?? 0, r.last_viewed_at);
    out.set(r.link_hash, v);
  }
  return out;
}

export interface PublicViews { pages: number; pdfs: number; uniqueToday: number; uniqueLast7Days: number }

/** Public-CV totals plus unique visitors. "Last 7 days" sums the daily unique counts (today and the six days before). */
export function publicViewStats(db: Db, now = Date.now()): Record<CvKey, PublicViews> {
  const out = Object.fromEntries(CV_KEYS.map((k) => [k, { pages: 0, pdfs: 0, uniqueToday: 0, uniqueLast7Days: 0 }])) as Record<CvKey, PublicViews>;
  for (const r of db.prepare("SELECT cv_key, kind, views FROM view_totals WHERE link_hash = ''").all() as { cv_key: CvKey; kind: ViewKind; views: number }[]) {
    if (out[r.cv_key]) out[r.cv_key][r.kind === 'pdf' ? 'pdfs' : 'pages'] = r.views;
  }
  const today = dayOf(now);
  const since = dayOf(now - 6 * DAY_MS);
  for (const r of db
    .prepare('SELECT cv_key, day, COUNT(*) AS n FROM visitors_daily WHERE day >= ? GROUP BY cv_key, day')
    .all(since) as { cv_key: CvKey; day: string; n: number }[]) {
    if (!out[r.cv_key]) continue;
    out[r.cv_key].uniqueLast7Days += r.n;
    if (r.day === today) out[r.cv_key].uniqueToday = r.n;
  }
  return out;
}

// ---- Prometheus text format -------------------------------------------------

/** Escapes a label value for the Prometheus text format (backslash, double quote, newline). */
export const escapeLabel = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const series = (name: string, labels: Record<string, string>, value: number): string =>
  `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}} ${value}`;

export function renderMetrics(db: Db, now = Date.now()): string {
  const lines: string[] = [];
  const stats = publicViewStats(db, now);

  lines.push('# HELP myceevee_cv_views_total Views of a public CV, by kind (page or pdf).', '# TYPE myceevee_cv_views_total counter');
  for (const cv of CV_KEYS) {
    for (const kind of VIEW_KINDS) lines.push(series('myceevee_cv_views_total', { cv, kind }, stats[cv][kind === 'pdf' ? 'pdfs' : 'pages']));
  }

  lines.push('# HELP myceevee_cv_unique_visitors_today Distinct visitors of a public CV so far today (UTC). Anonymous and per day: the same person on two days counts once each day.', '# TYPE myceevee_cv_unique_visitors_today gauge');
  for (const cv of CV_KEYS) lines.push(series('myceevee_cv_unique_visitors_today', { cv }, stats[cv].uniqueToday));

  // Links that share a label are added together. Links without a label are reported as "Untitled", as in /admin.
  const perLabel = db
    .prepare("SELECT cv_key, kind, label, SUM(views) AS views FROM view_totals WHERE link_hash <> '' GROUP BY cv_key, kind, label ORDER BY cv_key, label, kind")
    .all() as { cv_key: CvKey; kind: ViewKind; label: string; views: number }[];
  lines.push('# HELP myceevee_link_views_total Views through short links, by CV, kind (page or pdf) and link label.', '# TYPE myceevee_link_views_total counter');
  for (const r of perLabel) lines.push(series('myceevee_link_views_total', { cv: r.cv_key, kind: r.kind, label: r.label || UNTITLED }, r.views));

  return `${lines.join('\n')}\n`;
}
