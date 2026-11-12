import { describe, expect, it } from 'vitest';
import { getSessionsNotBefore, revokeAllSessions } from '../src/lib/adminSession';
import { createSession, verifySession } from '../src/lib/auth';
import { openDb } from '../src/lib/db';

describe('session revocation store', () => {
  it('starts at 0 and persists the latest revocation time', () => {
    const db = openDb(':memory:');
    expect(getSessionsNotBefore(db)).toBe(0);
    revokeAllSessions(db, 5000);
    expect(getSessionsNotBefore(db)).toBe(5000);
    revokeAllSessions(db, 9000);
    expect(getSessionsNotBefore(db)).toBe(9000);
  });
  it('invalidates earlier sessions end to end', () => {
    const db = openDb(':memory:');
    const secret = 'k'.repeat(32);
    const cookie = createSession(1000, secret);
    expect(verifySession(cookie, 2000, secret, getSessionsNotBefore(db))).toBe(true);
    revokeAllSessions(db, 1500);
    expect(verifySession(cookie, 2000, secret, getSessionsNotBefore(db))).toBe(false);
    expect(verifySession(createSession(1600, secret), 2000, secret, getSessionsNotBefore(db))).toBe(true);
  });
});
