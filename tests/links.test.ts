import { describe, expect, it } from 'vitest';
import { openDb } from '../src/lib/db';
import {
  createLink, generateToken, hashToken, isPublic, listActiveLinks, pruneLinks, publicKeys,
  resolveLink, revokeLink, setPublic, TOKEN_LENGTH,
} from '../src/lib/links';

const fresh = () => openDb(':memory:');

describe('visibility', () => {
  it('defaults to private and toggles', () => {
    const db = fresh();
    expect(isPublic(db, 'full')).toBe(false);
    setPublic(db, 'one-page', true);
    expect(isPublic(db, 'one-page')).toBe(true);
    expect(publicKeys(db)).toEqual(['one-page']);
    setPublic(db, 'one-page', false);
    expect(publicKeys(db)).toEqual([]);
  });
});

describe('tokens', () => {
  it('are base62 and the expected length', () => {
    for (let i = 0; i < 50; i++) expect(generateToken()).toMatch(new RegExp(`^[0-9A-Za-z]{${TOKEN_LENGTH}}$`));
  });
});

describe('short links', () => {
  it('resolves until the TTL boundary, then stops', () => {
    const db = fresh();
    const t0 = 1_000_000;
    const { token, expiresAt } = createLink(db, { cvKey: 'full', ttlSeconds: 60 }, t0);
    expect(expiresAt).toBe(t0 + 60_000);
    expect(resolveLink(db, token, t0 + 59_999)).toBe('full');
    expect(resolveLink(db, token, t0 + 60_000)).toBeNull();
  });

  it('returns null for unknown tokens', () => {
    expect(resolveLink(fresh(), 'nope')).toBeNull();
  });

  it('stops resolving once revoked', () => {
    const db = fresh();
    const { token } = createLink(db, { cvKey: 'one-page', ttlSeconds: 3600 }, 0);
    revokeLink(db, hashToken(token), 10);
    expect(resolveLink(db, token, 20)).toBeNull();
    expect(listActiveLinks(db, 20)).toHaveLength(0);
  });

  it('stores only the hash, never the token', () => {
    const db = fresh();
    const { token } = createLink(db, { cvKey: 'full', ttlSeconds: 60, label: ' ACME ' });
    const rows = db.prepare('SELECT * FROM links').all() as Record<string, unknown>[];
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.token_hash).toBe(hashToken(token));
    expect(rows[0]!.label).toBe('ACME');
  });

  it('rejects non-positive TTLs', () => {
    expect(() => createLink(fresh(), { cvKey: 'full', ttlSeconds: 0 })).toThrow();
  });

  it('prunes links expired more than a day ago', () => {
    const db = fresh();
    createLink(db, { cvKey: 'full', ttlSeconds: 1 }, 0);
    pruneLinks(db, 3600_000);
    expect(db.prepare('SELECT COUNT(*) c FROM links').get()).toEqual({ c: 1 });
    pruneLinks(db, 2 * 24 * 3600_000);
    expect(db.prepare('SELECT COUNT(*) c FROM links').get()).toEqual({ c: 0 });
  });
});
