import { createHash, randomBytes } from 'node:crypto';
import { CV_KEYS, type CvKey } from './config';
import type { Db } from './db';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const TOKEN_LENGTH = 10;

export interface LinkRow {
  token_hash: string;
  cv_key: CvKey;
  label: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 10 base62 chars (~59 bits). Rejection sampling avoids modulo bias. */
export function generateToken(): string {
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    for (const b of randomBytes(TOKEN_LENGTH * 2)) {
      if (b < 248 && out.length < TOKEN_LENGTH) out += ALPHABET[b % 62]; // 248 = 62 * 4
    }
  }
  return out;
}

// ---- visibility -------------------------------------------------------------

export function isPublic(db: Db, key: CvKey): boolean {
  const row = db.prepare('SELECT public FROM cv_settings WHERE cv_key = ?').get(key) as { public: number } | undefined;
  return row?.public === 1;
}

export function setPublic(db: Db, key: CvKey, value: boolean): void {
  db.prepare(
    'INSERT INTO cv_settings (cv_key, public) VALUES (?, ?) ON CONFLICT(cv_key) DO UPDATE SET public = excluded.public',
  ).run(key, value ? 1 : 0);
}

export function publicKeys(db: Db): CvKey[] {
  return CV_KEYS.filter((k) => isPublic(db, k));
}

// ---- short links ------------------------------------------------------------

export function createLink(
  db: Db,
  input: { cvKey: CvKey; ttlSeconds: number; label?: string },
  now = Date.now(),
): { token: string; expiresAt: number } {
  if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) throw new Error('TTL must be positive');
  const token = generateToken();
  const expiresAt = now + Math.round(input.ttlSeconds * 1000);
  db.prepare(
    'INSERT INTO links (token_hash, cv_key, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), input.cvKey, input.label?.trim() || null, now, expiresAt);
  return { token, expiresAt };
}

export interface ResolvedLink {
  cvKey: CvKey;
  tokenHash: string;
  label: string | null;
}

/** Like resolveLink, but also returns the link's hash and label (for counting views). Null if unknown, expired or revoked. */
export function resolveLinkDetail(db: Db, token: string, now = Date.now()): ResolvedLink | null {
  const tokenHash = hashToken(token);
  const row = db
    .prepare('SELECT cv_key, label FROM links WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL')
    .get(tokenHash, now) as { cv_key: CvKey; label: string | null } | undefined;
  return row ? { cvKey: row.cv_key, tokenHash, label: row.label } : null;
}

/** Returns the CV a token grants access to, or null if unknown, expired or revoked. */
export function resolveLink(db: Db, token: string, now = Date.now()): CvKey | null {
  return resolveLinkDetail(db, token, now)?.cvKey ?? null;
}

export function listActiveLinks(db: Db, now = Date.now()): LinkRow[] {
  return db
    .prepare('SELECT * FROM links WHERE expires_at > ? AND revoked_at IS NULL ORDER BY expires_at ASC')
    .all(now) as LinkRow[];
}

export function revokeLink(db: Db, tokenHash: string, now = Date.now()): void {
  db.prepare('UPDATE links SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now, tokenHash);
}

/** Lazily deletes links that expired or were revoked more than a day ago. */
export function pruneLinks(db: Db, now = Date.now()): void {
  const cutoff = now - 24 * 3600_000;
  db.prepare('DELETE FROM links WHERE expires_at < ? OR revoked_at < ?').run(cutoff, cutoff);
}
