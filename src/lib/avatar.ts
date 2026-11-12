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

  async function download(hash: string): Promise<string | null> {
    try {
      const res = await doFetch(`${base()}/avatar/${hash}?s=${AVATAR_PX}&d=404`, {
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

  return {
    async get(email?: string): Promise<string | null> {
      if (!email?.trim()) return null;
      const hash = gravatarHash(email);
      const hit = cache.get(hash);
      if (hit && now() - hit.at < (hit.value ? hitTtl() : missTtl)) return hit.value;
      const value = await download(hash);
      // Keep the last good photo if a refresh fails.
      cache.set(hash, { at: now(), value: value ?? hit?.value ?? null });
      return value ?? hit?.value ?? null;
    },
    refresh: () => cache.clear(),
  };
}

export const avatar = createAvatarClient();
