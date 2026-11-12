import { describe, expect, it } from 'vitest';
import { adminTokenProblem, checkAdminToken, createSession, sessionSecretProblem, SESSION_TTL_MS, verifySession } from '../src/lib/auth';
import { createFailureLimiter, createRateLimiter } from '../src/lib/ratelimit';

const secret = 'test-secret';

const good = 'f2a91c7e5b3d48a6b0c1d2e3f4a5b6c7';

describe('admin token', () => {
  it('accepts only the exact token', () => {
    expect(checkAdminToken(good, good)).toBe(true);
    expect(checkAdminToken(good + 'x', good)).toBe(false);
    expect(checkAdminToken('', good)).toBe(false);
  });
  it('refuses weak, short and placeholder tokens even when typed exactly', () => {
    expect(checkAdminToken('hunter2', 'hunter2')).toBe(false);
    expect(checkAdminToken('change-me', 'change-me')).toBe(false);
    expect(checkAdminToken('Change-Me-please-123456', 'Change-Me-please-123456')).toBe(false);
  });
  it('explains what is wrong with a configured secret, without echoing it', () => {
    expect(adminTokenProblem(good)).toBeNull();
    expect(adminTokenProblem('')).toMatch(/not set/);
    expect(adminTokenProblem('short1')).toMatch(/too short.*12/);
    expect(adminTokenProblem('change-me')).toMatch(/placeholder/);
    expect(adminTokenProblem('short1')).not.toContain('short1');
    expect(sessionSecretProblem('x'.repeat(32))).toBeNull();
    expect(sessionSecretProblem('x'.repeat(31))).toMatch(/too short.*32/);
    expect(sessionSecretProblem('change-me-to-a-long-random-string')).toMatch(/placeholder/);
  });
  it('rejects everything when no token is configured', () => {
    expect(checkAdminToken('', '')).toBe(false);
    expect(checkAdminToken('x', '')).toBe(false);
  });
});

describe('session cookie', () => {
  it('verifies a fresh cookie and rejects it after expiry', () => {
    const c = createSession(0, secret);
    expect(verifySession(c, 1000, secret)).toBe(true);
    expect(verifySession(c, SESSION_TTL_MS + 1, secret)).toBe(false);
  });
  it('rejects tampering, a wrong secret and garbage', () => {
    const c = createSession(0, secret);
    const [payload, mac] = c.split('.');
    expect(verifySession(`${Number(payload) + 99999999}.${mac}`, 1, secret)).toBe(false);
    expect(verifySession(c, 1, 'other-secret')).toBe(false);
    expect(verifySession('garbage', 1, secret)).toBe(false);
    expect(verifySession(undefined, 1, secret)).toBe(false);
  });
  it('rejects sessions issued before notBefore (sign-out), but not ones issued after', () => {
    const old = createSession(1000, secret);
    const fresh = createSession(5000, secret);
    expect(verifySession(old, 6000, secret, 3000)).toBe(false);
    expect(verifySession(fresh, 6000, secret, 3000)).toBe(true);
    expect(verifySession(old, 6000, secret, 0)).toBe(true);
  });
  it('refuses to work without a secret', () => {
    expect(() => createSession(0, '')).toThrow();
    expect(verifySession('1.2', 0, '')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('blocks after the limit and resets after the window', () => {
    let t = 0;
    const rl = createRateLimiter(2, 1000, () => t);
    expect(rl.allow('ip')).toBe(true);
    expect(rl.allow('ip')).toBe(true);
    expect(rl.allow('ip')).toBe(false);
    expect(rl.allow('other')).toBe(true);
    t = 1000;
    expect(rl.allow('ip')).toBe(true);
  });
});

describe('failure limiter', () => {
  it('locks after N failures, reports the wait, and unlocks when the window ends', () => {
    let t = 0;
    const l = createFailureLimiter(3, 1000, () => t);
    expect(l.recordFailure('ip')).toBe(false);
    expect(l.recordFailure('ip')).toBe(false);
    expect(l.isLocked('ip')).toBe(false);
    expect(l.recordFailure('ip')).toBe(true); // this one triggered the lock
    expect(l.isLocked('ip')).toBe(true);
    expect(l.retryAfter('ip')).toBe(1);
    expect(l.isLocked('other')).toBe(false);
    t = 1000;
    expect(l.isLocked('ip')).toBe(false);
    expect(l.retryAfter('ip')).toBe(0);
  });
  it('a success (reset) clears the count, so correct logins never use up attempts', () => {
    const l = createFailureLimiter(2, 1000, () => 0);
    l.recordFailure('ip'); l.reset('ip'); l.recordFailure('ip');
    expect(l.isLocked('ip')).toBe(false);
  });
});
