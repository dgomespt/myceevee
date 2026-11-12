import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AVATAR_CACHE_MS, DEFAULT_GIST_CACHE_MS, config } from '../src/lib/config';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('cache TTL settings', () => {
  it('default to 1 hour (gist) and 1 day (photo)', () => {
    vi.stubEnv('GIST_CACHE_TTL', ''); vi.stubEnv('AVATAR_CACHE_TTL', '');
    expect(config.gistCacheMs).toBe(DEFAULT_GIST_CACHE_MS);
    expect(config.avatarCacheMs).toBe(DEFAULT_AVATAR_CACHE_MS);
  });
  it('are read from the environment', () => {
    vi.stubEnv('GIST_CACHE_TTL', '6h'); vi.stubEnv('AVATAR_CACHE_TTL', '7d');
    expect(config.gistCacheMs).toBe(6 * 3_600_000);
    expect(config.avatarCacheMs).toBe(7 * 86_400_000);
  });
  it('fall back to the default and warn once when invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('GIST_CACHE_TTL', 'soon');
    expect(config.gistCacheMs).toBe(DEFAULT_GIST_CACHE_MS);
    expect(config.gistCacheMs).toBe(DEFAULT_GIST_CACHE_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('GIST_CACHE_TTL');
  });
});
