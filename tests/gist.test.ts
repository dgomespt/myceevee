import { describe, expect, it } from 'vitest';
import { createGistClient, parseGistId } from '../src/lib/gist';
import { fullResume, onePageResume } from './fixtures';

const ID = 'abc123abc123abc123abc123';
const files = () => ({ full: 'resume.json', 'one-page': 'resume.onepage.json' }) as const;

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gistBody = {
  files: {
    'resume.json': { content: JSON.stringify(fullResume) },
    'resume.onepage.json': { content: JSON.stringify(onePageResume) },
  },
};

describe('gist client', () => {
  it('loads and validates both files', async () => {
    const { f } = fakeFetch(() => json(gistBody));
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => '', files });
    const full = await g.load('full');
    expect(full.ok && full.resume.basics?.name).toBe('Ada Lovelace');
    expect(full.ok && full.warnings).toEqual([]);
    expect((await g.load('one-page')).ok).toBe(true);
  });

  it('caches within the TTL and refetches after it', async () => {
    let t = 0;
    const { f, calls } = fakeFetch(() => json(gistBody));
    const g = createGistClient({ fetch: f, now: () => t, ttlMs: 1000, gistId: () => ID, token: () => '', files });
    await g.load('full'); await g.load('one-page');
    expect(calls).toHaveLength(1);
    t = 1001;
    await g.load('full');
    expect(calls).toHaveLength(2);
  });

  it('refresh() drops the cache', async () => {
    const { f, calls } = fakeFetch(() => json(gistBody));
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => '', files });
    await g.load('full'); g.refresh(); await g.load('full');
    expect(calls).toHaveLength(2);
  });

  it('serves stale data when GitHub fails after a good fetch', async () => {
    let t = 0; let fail = false;
    const { f } = fakeFetch(() => (fail ? json({}, 500) : json(gistBody)));
    const g = createGistClient({ fetch: f, now: () => t, ttlMs: 10, gistId: () => ID, token: () => '', files });
    expect((await g.load('full')).ok).toBe(true);
    t = 100; fail = true;
    expect((await g.load('full')).ok).toBe(true);
  });

  it('reports an error when GitHub fails with nothing cached', async () => {
    const { f } = fakeFetch(() => json({}, 404));
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => '', files });
    const r = await g.load('full');
    expect(!r.ok && r.error).toMatch(/404/);
  });

  it('reports missing GIST_ID, missing files and bad JSON', async () => {
    const noId = createGistClient({ fetch: fakeFetch(() => json(gistBody)).f, gistId: () => '', token: () => '', files });
    expect((await noId.load('full')).ok).toBe(false);

    const { f } = fakeFetch(() => json({ files: { 'resume.json': { content: '{nope' } } }));
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => '', files, sections: () => ({ full: '', onepage: '' }) });
    const bad = await g.load('full');
    expect(!bad.ok && bad.error).toMatch(/not valid JSON/);
    const missing = await g.load('one-page');
    expect(!missing.ok && missing.error).toMatch(/resume\.onepage\.json.*not found/);
    const empty = createGistClient({ fetch: fakeFetch(() => json({ files: {} })).f, gistId: () => ID, token: () => '', files, sections: () => ({ full: '', onepage: 'work' }) });
    const none = await empty.load('one-page');
    expect(!none.ok && none.error).toMatch(/Neither "resume\.onepage\.json" nor "resume\.json"/);
    const noFull = await empty.load('full');
    expect(!noFull.ok && noFull.error).toMatch(/"resume\.json" was not found/);
  });

  it('follows raw_url for truncated files and sends the token only to the API', async () => {
    const seen: Record<string, unknown> = {};
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen[String(url)] = init?.headers;
      if (String(url).includes('api.github.com')) {
        return json({ files: { 'resume.json': { truncated: true, raw_url: 'https://gist.githubusercontent.com/raw' } } });
      }
      return new Response(JSON.stringify(fullResume));
    }) as typeof fetch;
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => 'tok', files });
    expect((await g.load('full')).ok).toBe(true);
    expect(JSON.stringify(seen['https://api.github.com/gists/' + ID])).toContain('Bearer tok');
    expect(JSON.stringify(seen['https://gist.githubusercontent.com/raw'])).not.toContain('Bearer');
  });

  it('surfaces schema violations as warnings without failing', async () => {
    const { f } = fakeFetch(() => json({ files: { 'resume.json': { content: JSON.stringify({ basics: { email: 'not-an-email' }, bogus: 1 }) } } }));
    const g = createGistClient({ fetch: f, gistId: () => ID, token: () => '', files });
    const r = await g.load('full');
    expect(r.ok && r.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseGistId', () => {
  const id = 'aa5a315d61ae9438b18d1234';
  it('accepts a bare id or a gist URL (with or without extras) and returns the id', () => {
    expect(parseGistId(id)).toBe(id);
    expect(parseGistId(`  ${id}\n`)).toBe(id);
    expect(parseGistId('12345678')).toBe('12345678'); // legacy numeric ids
    expect(parseGistId(`https://gist.github.com/someone/${id}`)).toBe(id);
    expect(parseGistId(`https://gist.github.com/someone/${id}/raw?x=1#frag`)).toBe(id);
    expect(parseGistId(`gist.github.com/someone/${id}`)).toBe(id);
    expect(parseGistId(`https://gist.github.com/${id}`)).toBe(id);
  });
  it('rejects usernames, profile pages and junk instead of guessing', () => {
    for (const bad of ['', 'someone', 'https://gist.github.com/someone', 'gist.github.com/someone/', 'not a ref!', 'abc']) {
      expect(parseGistId(bad)).toBeNull();
    }
  });
});

describe('GIST_ID handling in the client', () => {
  it('loads from the id inside a gist URL', async () => {
    const { f, calls } = fakeFetch(() => json(gistBody));
    const g = createGistClient({ fetch: f, gistId: () => `https://gist.github.com/someone/${ID}`, token: () => '', files });
    expect((await g.load('full')).ok).toBe(true);
    expect(calls[0]).toMatch(new RegExp(`/gists/${ID}$`));
  });
  it('explains a username/profile value without calling GitHub', async () => {
    const { f, calls } = fakeFetch(() => json(gistBody));
    const g = createGistClient({ fetch: f, gistId: () => 'https://gist.github.com/someone', token: () => '', files });
    const r = await g.load('full');
    expect(!r.ok && r.error).toMatch(/not a gist id or gist URL/);
    expect(calls).toHaveLength(0);
  });
  it('reports an unset GIST_ID', async () => {
    const g = createGistClient({ fetch: fakeFetch(() => json(gistBody)).f, gistId: () => '  ', token: () => '', files });
    const r = await g.load('full');
    expect(!r.ok && r.error).toMatch(/GIST_ID is not configured/);
  });
  it('a 404 for the id points at checking GIST_ID', async () => {
    const g = createGistClient({ fetch: fakeFetch(() => json({}, 404)).f, gistId: () => ID, token: () => '', files });
    const r = await g.load('full');
    expect(!r.ok && r.error).toMatch(/404.*Check that GIST_ID/);
  });
});

describe('section views', () => {
  const big = {
    basics: { name: 'Ada', summary: 'Hello' },
    work: [
      { name: 'Oldest', startDate: '2001', endDate: '2004' },
      { name: 'Newest', startDate: '2020' },
      { name: 'Middle', startDate: '2010', endDate: '2015' },
      { name: 'Recent', startDate: '2015', endDate: '2019' },
    ],
    projects: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }],
    education: [{ institution: 'U' }],
    skills: [{ name: 'S', keywords: ['x'] }],
    interests: [{ name: 'Chess' }],
  };
  const onlyFull = () => json({ files: { 'resume.json': { content: JSON.stringify(big) } } });
  const client = (sections: { full: string; onepage: string }, gistBodyFn: () => Response = onlyFull) =>
    createGistClient({ fetch: fakeFetch(gistBodyFn).f, gistId: () => ID, token: () => '', files, sections: () => sections });

  it('derives the one-page CV from resume.json when ONEPAGE_SECTIONS is set and there is no one-page file', async () => {
    const r = await client({ full: '', onepage: 'summary, work:3, projects:2, education, skills' }).load('one-page');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order).toEqual(['summary', 'work', 'projects', 'education', 'skills']);
    expect(r.resume.work!.map((w) => w.name)).toEqual(['Newest', 'Middle', 'Recent']); // 3 most recent, in file order
    expect(r.resume.projects).toHaveLength(2);
    expect(r.resume.interests).toBeUndefined();
    expect(r.derived?.from).toBe('resume.json');
  });

  it('does NOT invent a one-page CV when ONEPAGE_SECTIONS is unset: it asks for the file or the setting', async () => {
    const r = await client({ full: '', onepage: '' }).load('one-page');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/resume\.onepage\.json.*not found.*ONEPAGE_SECTIONS/);
    // ...and the full CV is unaffected.
    expect((await client({ full: '', onepage: '' }).load('full')).ok).toBe(true);
  });

  it('uses ONEPAGE_SECTIONS, in the listed order, with most-recent limits', async () => {
    const r = await client({ full: '', onepage: 'education, experience:2, skills' }).load('one-page');
    expect(r.ok && r.order).toEqual(['education', 'work', 'skills']);
    expect(r.ok && r.resume.work!.map((w) => w.name)).toEqual(['Newest', 'Recent']);
    expect(r.ok && r.resume.basics?.summary).toBeUndefined();
    expect(r.ok && r.derived?.spec).toBe('education, experience:2, skills');
  });

  it('shows a curated one-page file exactly as written, ignoring ONEPAGE_SECTIONS', async () => {
    const both = () => json({ files: {
      'resume.json': { content: JSON.stringify(big) },
      'resume.onepage.json': { content: JSON.stringify({ basics: { name: 'Ada', summary: 'Short' }, work: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }) },
    } });
    const r = await client({ full: '', onepage: 'work:1' }, both).load('one-page');
    expect(r.ok && r.resume.work).toHaveLength(3);
    expect(r.ok && r.derived).toBeUndefined();
    expect(r.ok && r.order.length).toBe(12);
  });

  it('does not silently fall back when the one-page file exists but is broken', async () => {
    const broken = () => json({ files: { 'resume.json': { content: JSON.stringify(big) }, 'resume.onepage.json': { content: '{oops' } } });
    const r = await client({ full: '', onepage: '' }, broken).load('one-page');
    expect(!r.ok && r.error).toMatch(/resume\.onepage\.json.*not valid JSON/);
  });

  it('shows the whole full CV unless FULL_SECTIONS is set, and then applies it', async () => {
    const all = await client({ full: '', onepage: '' }).load('full');
    expect(all.ok && all.order.length).toBe(12);
    expect(all.ok && all.resume.work).toHaveLength(4);
    const some = await client({ full: 'summary, work:1, education', onepage: '' }).load('full');
    expect(some.ok && some.order).toEqual(['summary', 'work', 'education']);
    expect(some.ok && some.resume.work!.map((w) => w.name)).toEqual(['Newest']);
    expect(some.ok && some.resume.skills).toBeUndefined();
  });

  it('reports section-list mistakes as warnings naming the setting, without breaking the page', async () => {
    const r = await client({ full: '', onepage: 'work:abc, nope, education' }).load('one-page');
    expect(r.ok && r.order).toEqual(['work', 'education']);
    expect(r.ok && r.warnings.some((w) => w.startsWith('ONEPAGE_SECTIONS:') && w.includes('abc'))).toBe(true);
    expect(r.ok && r.warnings.some((w) => w.includes('"nope"'))).toBe(true);
  });
});
