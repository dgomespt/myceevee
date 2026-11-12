import { createHash } from 'node:crypto';
import { config } from './config';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 200_000;
export const AVATAR_PX = 192; // rendered at 96 CSS px, so crisp on 2x screens

/** Gravatar identifies people by the SHA-256 of their trimmed, lowercased email address. */
export function gravatarHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export interface AvatarClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  hitTtlMs?: number;
  missTtlMs?: number;
  base?: () => string;
}

/**
 * The photo address from a CV (basics.image) as a URL, but only if the server may fetch it: an https Gravatar address
 * (gravatar.com or one of its subdomains), or an address on the origin set as GRAVATAR_BASE_URL. Gist content is
 * untrusted, so any other host is refused: the server never makes requests to arbitrary addresses taken from it.
 */
export function fetchablePhotoUrl(address: string, base: string): URL | null {
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:' && (host === 'gravatar.com' || host.endsWith('.gravatar.com'))) return url;
  try { return url.origin === new URL(base).origin ? url : null; } catch { return null; }
}

/**
 * Fetches a Gravatar server-side and returns it as a data: URI, so visitors never contact Gravatar and the
 * email hash never appears in the page. Misses (no Gravatar, errors, odd responses) return null and are cached
 * briefly so a slow or down Gravatar can't slow every page view.
 */
export function createAvatarClient(opts: AvatarClientOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const hitTtl = () => opts.hitTtlMs ?? config.avatarCacheMs;
  const missTtl = opts.missTtlMs ?? 10 * 60_000;
  const base = opts.base ?? (() => config.gravatarBase);
  const cache = new Map<string, { at: number; value: string | null }>();

  async function download(url: string): Promise<string | null> {
    try {
      const res = await doFetch(url, {
        headers: { 'User-Agent': 'myceevee' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED_TYPES.has(type)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async function cached(key: string, url: string): Promise<string | null> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.value ? hitTtl() : missTtl)) return hit.value;
    const value = await download(url);
    // Keep the last good photo if a refresh fails.
    cache.set(key, { at: now(), value: value ?? hit?.value ?? null });
    return value ?? hit?.value ?? null;
  }

  return {
    async get(email?: string): Promise<string | null> {
      if (!email?.trim()) return null;
      const hash = gravatarHash(email);
      return cached(hash, `${base()}/avatar/${hash}?s=${AVATAR_PX}&d=404`);
    },
    /** For a photo address written in the CV (basics.image): fetched only if it passes fetchablePhotoUrl, else null. */
    async getUrl(address?: string): Promise<string | null> {
      const url = address ? fetchablePhotoUrl(address, base()) : null;
      return url ? cached(`url:${url.href}`, url.href) : null;
    },
    refresh: () => cache.clear(),
  };
}

export const avatar = createAvatarClient();
