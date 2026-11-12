import { parseDuration } from './duration';
import { safeUrl } from './format';

export type CvKey = 'one-page' | 'full';
export const CV_KEYS: readonly CvKey[] = ['one-page', 'full'] as const;

export const CV_LABELS: Record<CvKey, string> = {
  'one-page': 'One-page CV',
  full: 'Full CV',
};

export function isCvKey(v: unknown): v is CvKey {
  return v === 'one-page' || v === 'full';
}

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;

export const DEFAULT_GIST_CACHE_MS = 60 * 60_000; // 1 hour
export const DEFAULT_AVATAR_CACHE_MS = 24 * 60 * 60_000; // 1 day
export const DEFAULT_METRICS_RETENTION_DAYS = 90;

const warned = new Set<string>();
/** Reads a duration env var such as "30m" or "6h"; falls back to the default (with a one-time warning) when invalid. */
function envDuration(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallbackMs;
  const ms = parseDuration(raw);
  if (ms === null) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[myceevee] ${name}="${raw}" is not a valid duration (use e.g. 30m, 6h, 2d; 1s to 30d). Using the default.`);
    }
    return fallbackMs;
  }
  return ms;
}

export const config = {
  get gistId() { return env('GIST_ID'); },
  get githubApi() { return env('GITHUB_API_URL', 'https://api.github.com').replace(/\/+$/, ''); },
  get gravatarBase() { return env('GRAVATAR_BASE_URL', 'https://gravatar.com').replace(/\/+$/, ''); },
  get gistCacheMs() { return envDuration('GIST_CACHE_TTL', DEFAULT_GIST_CACHE_MS); },
  get avatarCacheMs() { return envDuration('AVATAR_CACHE_TTL', DEFAULT_AVATAR_CACHE_MS); },
  /** Section lists (see src/lib/sections.ts). Empty FULL_SECTIONS = show everything. Empty ONEPAGE_SECTIONS = no derived one-page CV (it needs its own gist file). */
  get fullSections() { return env('FULL_SECTIONS').trim(); },
  get onepageSections() { return env('ONEPAGE_SECTIONS').trim(); },
  /** Where the homepage sends visitors when nothing is public. Only http(s) URLs are accepted. */
  get homeRedirectUrl(): string | undefined {
    const raw = env('HOME_REDIRECT_URL').trim();
    if (!raw) return undefined;
    const url = safeUrl(raw);
    if (!url && !warned.has('HOME_REDIRECT_URL')) {
      warned.add('HOME_REDIRECT_URL');
      console.warn(`[myceevee] HOME_REDIRECT_URL="${raw}" is not an http(s) URL, so it is ignored.`);
    }
    return url;
  },
  get githubToken() { return env('GITHUB_TOKEN'); },
  get gistFiles(): Record<CvKey, string> {
    return {
      full: env('GIST_FILE_FULL', 'resume.json'),
      'one-page': env('GIST_FILE_ONEPAGE', 'resume.onepage.json'),
    };
  },
  get adminToken() { return env('ADMIN_TOKEN'); },
  /** Bearer token for GET /metrics. Unset (or weak) = the endpoint is off and answers 404. */
  get metricsToken() { return env('METRICS_TOKEN'); },
  /** How many days per-day unique-visitor rows are kept (whole days, 1 to 3650; default 90). View totals are never pruned. */
  get metricsRetentionDays(): number {
    const raw = env('METRICS_RETENTION_DAYS').trim();
    if (raw === '') return DEFAULT_METRICS_RETENTION_DAYS;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 3650) return n;
    if (!warned.has('METRICS_RETENTION_DAYS')) {
      warned.add('METRICS_RETENTION_DAYS');
      console.warn(`[myceevee] METRICS_RETENTION_DAYS="${raw}" is not a whole number of days (1 to 3650). Using ${DEFAULT_METRICS_RETENTION_DAYS}.`);
    }
    return DEFAULT_METRICS_RETENTION_DAYS;
  },
  get sessionSecret() { return env('SESSION_SECRET'); },
  get baseUrl() { return env('PUBLIC_BASE_URL', 'http://localhost:4321').replace(/\/+$/, ''); },
  get databasePath() { return env('DATABASE_PATH', './data/myceevee.db'); },
};
