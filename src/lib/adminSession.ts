import { SESSION_COOKIE, verifySession } from './auth';
import { config } from './config';
import { getDb, type Db } from './db';

const KEY = 'sessions_not_before';

/** Sessions issued before this time are no longer valid (set by sign-out). 0 = none revoked. */
export function getSessionsNotBefore(db: Db): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as { value: string } | undefined;
  return row ? Number(row.value) || 0 : 0;
}

/** Ends every admin session issued up to now, on every browser. */
export function revokeAllSessions(db: Db, now = Date.now()): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, String(now));
}

/** Is this cookie a valid, unexpired, not-revoked admin session? */
export function isAdminSession(cookie: string | undefined): boolean {
  return verifySession(cookie, Date.now(), config.sessionSecret, getSessionsNotBefore(getDb()));
}

export { SESSION_COOKIE };
