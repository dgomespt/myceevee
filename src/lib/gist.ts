import { CV_KEYS, config, type CvKey } from './config';
import type { Resume } from './resume';
import { validateResume } from './validate';
import { ALL_SECTIONS, applySections, parseSections, type SectionKey } from './sections';

export type LoadResult =
  | {
      ok: true;
      resume: Resume;
      warnings: string[];
      /** Sections to render, in order. */
      order: readonly SectionKey[];
      /** Set when the CV was built from another file instead of having its own. */
      derived?: { from: string; spec: string };
    }
  | { ok: false; error: string };

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface GistResponse { files?: Record<string, GistFile | null> }

export interface GistClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  gistId?: () => string;
  token?: () => string;
  files?: () => Record<CvKey, string>;
  /** Section lists for the full CV and for a one-page CV derived from the full one. Empty string = defaults. */
  sections?: () => { full: string; onepage: string };
}

const looksLikeId = (v: string) => /^[0-9a-f]{20,}$/i.test(v) || /^\d+$/.test(v);

/**
 * GIST_ID is a gist id ("aa5a315d61ae9438b18d1234...") or the gist's URL ("https://gist.github.com/user/<id>").
 * Returns the id, or null for anything else (including a username or profile page, which isn't one specific gist).
 */
export function parseGistId(value: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v) || /^gist\.github\.com\//i.test(v)) {
    const path = v.replace(/^https?:\/\//i, '').split(/[?#]/)[0]!.split('/').slice(1).filter(Boolean);
    const id = path.length >= 2 ? path[1]! : path[0];
    return id && looksLikeId(id) ? id : null;
  }
  return looksLikeId(v) ? v : null;
}

/** Fetches JSON Resume files from a gist with an in-memory cache that falls back to stale data on errors. */
export function createGistClient(opts: GistClientOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const ttl = () => opts.ttlMs ?? config.gistCacheMs;
  const gistId = opts.gistId ?? (() => config.gistId);
  const token = opts.token ?? (() => config.githubToken);
  const fileNames = opts.files ?? (() => config.gistFiles);
  const sectionLists = opts.sections ?? (() => ({ full: config.fullSections, onepage: config.onepageSections }));

  let cache: { at: number; raw: Partial<Record<CvKey, string>> } | null = null;
  let inflight: Promise<Partial<Record<CvKey, string>>> | null = null;

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'myceevee' };
    if (token()) h.Authorization = `Bearer ${token()}`;
    return h;
  };

  async function download(): Promise<Partial<Record<CvKey, string>>> {
    const configured = gistId().trim();
    if (!configured) throw new Error('GIST_ID is not configured');
    const id = parseGistId(configured);
    if (!id) {
      throw new Error(`GIST_ID "${configured}" is not a gist id or gist URL. Use the id from the gist's address (https://gist.github.com/you/<id>); a username or profile page isn't enough.`);
    }
    const res = await doFetch(`${config.githubApi}/gists/${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (res.status === 404) {
      throw new Error(`GitHub returned 404 for gist "${id}". Check that GIST_ID is the id of an existing gist.`);
    }
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for gist ${id}`);
    const gist = (await res.json()) as GistResponse;
    const names = fileNames();
    const raw: Partial<Record<CvKey, string>> = {};
    for (const key of CV_KEYS) {
      const file = gist.files?.[names[key]];
      if (!file) continue;
      if (file.truncated && file.raw_url) {
        const r = await doFetch(file.raw_url, { headers: { 'User-Agent': 'myceevee' } });
        if (!r.ok) throw new Error(`GitHub returned ${r.status} for ${names[key]}`);
        raw[key] = await r.text();
      } else if (typeof file.content === 'string') {
        raw[key] = file.content;
      }
    }
    return raw;
  }

  async function getRaw(): Promise<Partial<Record<CvKey, string>>> {
    if (cache && now() - cache.at < ttl()) return cache.raw;
    inflight ??= download().finally(() => { inflight = null; });
    try {
      const raw = await inflight;
      cache = { at: now(), raw };
      return raw;
    } catch (err) {
      if (cache) return cache.raw; // stale-on-error
      throw err;
    }
  }

  /** Parses one gist file. `null` means the file isn't in the gist. */
  function parseFile(raw: Partial<Record<CvKey, string>>, key: CvKey): { ok: true; doc: Resume } | { ok: false; error: string } | null {
    const text = raw[key];
    if (text === undefined) return null;
    const name = fileNames()[key];
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `File "${name}" is not valid JSON: ${(err as Error).message}` };
    }
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      return { ok: false, error: `File "${name}" must contain a JSON object` };
    }
    return { ok: true, doc: doc as Resume };
  }

  async function load(key: CvKey): Promise<LoadResult> {
    let raw: Partial<Record<CvKey, string>>;
    try {
      raw = await getRaw();
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    const names = fileNames();
    const lists = sectionLists();

    // The CV's own file, if it has one.
    const own = parseFile(raw, key);
    if (own && !own.ok) return own;
    if (own && key === 'one-page') {
      // A curated one-page file is shown exactly as written.
      return { ok: true, resume: own.doc, warnings: validateResume(own.doc), order: ALL_SECTIONS };
    }

    // A one-page CV with no file of its own is only built from resume.json when ONEPAGE_SECTIONS says how.
    if (key === 'one-page' && !lists.onepage) {
      return {
        ok: false,
        error: `File "${names['one-page']}" was not found in the gist. Add it, or set ONEPAGE_SECTIONS in .env to build the one-page CV from "${names.full}".`,
      };
    }

    // Otherwise the view is built from resume.json (the full CV, or a derived one-page CV).
    const source = key === 'full' ? own : parseFile(raw, 'full');
    if (source && !source.ok) return source;
    if (!source) {
      return {
        ok: false,
        error: key === 'full'
          ? `File "${names.full}" was not found in the gist`
          : `Neither "${names['one-page']}" nor "${names.full}" was found in the gist`,
      };
    }
    const warnings = validateResume(source.doc);
    const spec = key === 'full' ? lists.full : lists.onepage;
    if (key === 'full' && !spec) return { ok: true, resume: source.doc, warnings, order: ALL_SECTIONS };

    const label = key === 'full' ? 'FULL_SECTIONS' : 'ONEPAGE_SECTIONS';
    const parsed = parseSections(spec);
    return {
      ok: true,
      resume: applySections(source.doc, parsed.specs),
      warnings: [...warnings, ...parsed.warnings.map((w) => `${label}: ${w}`)],
      order: parsed.specs.map((s) => s.key),
      ...(key === 'one-page' ? { derived: { from: names.full, spec } } : {}),
    };
  }

  return { load, refresh: () => { cache = null; } };
}

export const gist = createGistClient();

/** Loads a CV for a public page: logs failures and returns the HTTP status the page should use. */
export async function loadCv(key: CvKey): Promise<{ result: LoadResult; status: number }> {
  const result = await gist.load(key);
  if (!result.ok) console.error(`[myceevee] could not load ${key}: ${result.error}`);
  return { result, status: result.ok ? 200 : 503 };
}
