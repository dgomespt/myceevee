import { afterEach, describe, expect, it, vi } from 'vitest';
import { metricsTokenProblem } from '../src/lib/auth';
import { DEFAULT_METRICS_RETENTION_DAYS, config } from '../src/lib/config';
import { openDb } from '../src/lib/db';
import { createLink, hashToken, pruneLinks, resolveLinkDetail } from '../src/lib/links';
import {
  escapeLabel, linkViewCounts, pruneVisitors, publicViewStats, recordView, renderMetrics, trackView, visitorId,
} from '../src/lib/metrics';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const fresh = () => openDb(':memory:');
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 12, 10, 0, 0); // 2026-11-12 10:00 UTC
const SECRET = 'a-secret-for-tests-a-secret-for-tests';

describe('visitorId', () => {
  it('is stable within a day and differs by address and by user agent', () => {
    const a = visitorId('1.2.3.4', 'UA', T0, SECRET);
    expect(visitorId('1.2.3.4', 'UA', T0 + 3_600_000, SECRET)).toBe(a);
    expect(visitorId('1.2.3.5', 'UA', T0, SECRET)).not.toBe(a);
    expect(visitorId('1.2.3.4', 'Other', T0, SECRET)).not.toBe(a);
  });

  it('changes the next UTC day, so nobody can be followed across days', () => {
    expect(visitorId('1.2.3.4', 'UA', T0 + DAY, SECRET)).not.toBe(visitorId('1.2.3.4', 'UA', T0, SECRET));
  });

  it('does not contain the address', () => {
    expect(visitorId('203.0.113.9', 'UA', T0, SECRET)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('public CV views', () => {
  it('counts pages and PDFs separately and unique visitors once per day', () => {
    const db = fresh();
    recordView(db, { cvKey: 'full', kind: 'page', visitor: 'v1' }, T0);
    recordView(db, { cvKey: 'full', kind: 'page', visitor: 'v1' }, T0 + 1000);
    recordView(db, { cvKey: 'full', kind: 'page', visitor: 'v2' }, T0 + 2000);
    recordView(db, { cvKey: 'full', kind: 'pdf', visitor: 'v1' }, T0 + 3000);
    const s = publicViewStats(db, T0 + 5000);
    expect(s.full).toEqual({ pages: 3, pdfs: 1, uniqueToday: 2, uniqueLast7Days: 2 });
    expect(s['one-page']).toEqual({ pages: 0, pdfs: 0, uniqueToday: 0, uniqueLast7Days: 0 });
  });

  it('counts the same visitor again on a later day and sums the week per day', () => {
    const db = fresh();
    recordView(db, { cvKey: 'one-page', kind: 'page', visitor: 'a' }, T0);
    recordView(db, { cvKey: 'one-page', kind: 'page', visitor: 'b' }, T0 + DAY); // a different day gives a different id in real use
    const s = publicViewStats(db, T0 + DAY);
    expect(s['one-page'].uniqueToday).toBe(1);
    expect(s['one-page'].uniqueLast7Days).toBe(2);
    expect(publicViewStats(db, T0 + 8 * DAY)['one-page'].uniqueLast7Days).toBe(0);
  });

  it('prunes visitor rows past the retention but keeps the totals', () => {
    const db = fresh();
    recordView(db, { cvKey: 'full', kind: 'page', visitor: 'old' }, T0 - 100 * DAY);
    recordView(db, { cvKey: 'full', kind: 'page', visitor: 'new' }, T0);
    pruneVisitors(db, 90, T0);
    const rows = db.prepare('SELECT visitor FROM visitors_daily').all() as { visitor: string }[];
    expect(rows.map((r) => r.visitor)).toEqual(['new']);
    expect(publicViewStats(db, T0).full.pages).toBe(2);
  });
});

describe('short link views', () => {
  it('are counted per link, with the label kept after the link is pruned', () => {
    const db = fresh();
    const t = 1_000_000;
    const { token } = createLink(db, { cvKey: 'full', ttlSeconds: 60, label: 'Acme recruiter' }, t);
    const link = resolveLinkDetail(db, token, t)!;
    expect(link).toEqual({ cvKey: 'full', tokenHash: hashToken(token), label: 'Acme recruiter' });
    recordView(db, { cvKey: 'full', kind: 'page', link }, t);
    recordView(db, { cvKey: 'full', kind: 'page', link }, t + 5);
    recordView(db, { cvKey: 'full', kind: 'pdf', link }, t + 9);

    expect(linkViewCounts(db).get(hashToken(token))).toEqual({ pages: 2, pdfs: 1, lastViewedAt: t + 9 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitors_daily').get()).toEqual({ n: 0 }); // links are not visitor-tracked

    pruneLinks(db, t + 10 * DAY); // the link row is gone...
    expect(renderMetrics(db)).toContain('myceevee_link_views_total{cv="full",kind="page",label="Acme recruiter"} 2'); // ...its numbers stay
  });

  it('do not count towards the public CV numbers', () => {
    const db = fresh();
    recordView(db, { cvKey: 'full', kind: 'page', link: { tokenHash: 'h', label: null } }, T0);
    expect(publicViewStats(db, T0).full.pages).toBe(0);
  });
});

describe('renderMetrics', () => {
  it('lists every CV and kind from the start, as zeros', () => {
    const out = renderMetrics(fresh(), T0);
    for (const cv of ['full', 'one-page']) {
      expect(out).toContain(`myceevee_cv_views_total{cv="${cv}",kind="page"} 0`);
      expect(out).toContain(`myceevee_cv_views_total{cv="${cv}",kind="pdf"} 0`);
      expect(out).toContain(`myceevee_cv_unique_visitors_today{cv="${cv}"} 0`);
    }
    expect(out).toContain('# TYPE myceevee_cv_views_total counter');
    expect(out).toContain('# TYPE myceevee_cv_unique_visitors_today gauge');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('adds links that share a label and calls unlabeled ones Untitled', () => {
    const db = fresh();
    recordView(db, { cvKey: 'full', kind: 'page', link: { tokenHash: 'h1', label: 'Acme' } }, T0);
    recordView(db, { cvKey: 'full', kind: 'page', link: { tokenHash: 'h2', label: 'Acme' } }, T0);
    recordView(db, { cvKey: 'one-page', kind: 'page', link: { tokenHash: 'h3', label: null } }, T0);
    const out = renderMetrics(db, T0);
    expect(out).toContain('myceevee_link_views_total{cv="full",kind="page",label="Acme"} 2');
    expect(out).toContain('myceevee_link_views_total{cv="one-page",kind="page",label="Untitled"} 1');
  });

  it('escapes quotes, backslashes and newlines in labels', () => {
    expect(escapeLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    const db = fresh();
    recordView(db, { cvKey: 'full', kind: 'page', link: { tokenHash: 'h', label: 'say "hi"' } }, T0);
    expect(renderMetrics(db, T0)).toContain('label="say \\"hi\\""');
  });
});

describe('trackView', () => {
  const req = (method: string) => new Request('http://x/cv/full', { method, headers: { 'user-agent': 'UA' } });

  it('records a GET and ignores HEAD', () => {
    const db = fresh();
    trackView(db, { cvKey: 'full', kind: 'page', request: req('HEAD'), clientAddress: '1.1.1.1' }, T0);
    expect(publicViewStats(db, T0).full.pages).toBe(0);
    trackView(db, { cvKey: 'full', kind: 'page', request: req('GET'), clientAddress: '1.1.1.1' }, T0);
    trackView(db, { cvKey: 'full', kind: 'page', request: req('GET'), clientAddress: '1.1.1.1' }, T0);
    expect(publicViewStats(db, T0).full).toMatchObject({ pages: 2, uniqueToday: 1 });
  });

  it('never stores the IP address or user agent', () => {
    const db = fresh();
    trackView(db, { cvKey: 'full', kind: 'page', request: req('GET'), clientAddress: '203.0.113.77' }, T0);
    const dump = JSON.stringify([db.prepare('SELECT * FROM visitors_daily').all(), db.prepare('SELECT * FROM view_totals').all()]);
    expect(dump).not.toContain('203.0.113.77');
    expect(dump).not.toContain('"UA"');
  });

  it('swallows database errors so a CV page never breaks', () => {
    const db = fresh();
    db.close();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackView(db, { cvKey: 'full', kind: 'page', request: req('GET'), clientAddress: '1.1.1.1' }, T0)).not.toThrow();
  });
});

describe('settings', () => {
  it('METRICS_TOKEN is off unless strong', () => {
    expect(metricsTokenProblem('')).toMatch(/not set/);
    expect(metricsTokenProblem('change-me-please-now-ok')).toMatch(/placeholder/);
    expect(metricsTokenProblem('short')).toMatch(/too short/);
    expect(metricsTokenProblem('0123456789abcdef')).toBeNull();
  });

  it('METRICS_RETENTION_DAYS defaults to 90 and falls back with one warning when invalid', () => {
    vi.stubEnv('METRICS_RETENTION_DAYS', '');
    expect(config.metricsRetentionDays).toBe(DEFAULT_METRICS_RETENTION_DAYS);
    vi.stubEnv('METRICS_RETENTION_DAYS', '30');
    expect(config.metricsRetentionDays).toBe(30);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('METRICS_RETENTION_DAYS', '0');
    expect(config.metricsRetentionDays).toBe(DEFAULT_METRICS_RETENTION_DAYS);
    expect(config.metricsRetentionDays).toBe(DEFAULT_METRICS_RETENTION_DAYS);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
