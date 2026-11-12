import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';

export const SESSION_COOKIE = 'myceevee_session';
export const SESSION_TTL_MS = 12 * 3600_000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const MIN_ADMIN_TOKEN_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;
const GENERATE_HINT = 'Generate one with: openssl rand -hex 16';

/** Why a configured secret is unacceptable, or null if it is fine. Placeholders from .env.example are rejected. */
function secretProblem(name: string, value: string, minLength: number): string | null {
  if (!value) return `${name} is not set. ${GENERATE_HINT}`;
  if (/^change-?me/i.test(value)) return `${name} is still the placeholder from .env.example. ${GENERATE_HINT}`;
  if (value.length < minLength) return `${name} is too short (at least ${minLength} characters). ${GENERATE_HINT}`;
  return null;
}
export const adminTokenProblem = (value = config.adminToken) => secretProblem('ADMIN_TOKEN', value, MIN_ADMIN_TOKEN_LENGTH);
export const sessionSecretProblem = (value = config.sessionSecret) => secretProblem('SESSION_SECRET', value, MIN_SESSION_SECRET_LENGTH);

/** First configuration problem that blocks admin login, or null. */
export function adminConfigProblem(): string | null {
  return adminTokenProblem() ?? sessionSecretProblem();
}

export function checkAdminToken(candidate: string, expected = config.adminToken): boolean {
  if (adminTokenProblem(expected)) return false; // never allow login with a missing, placeholder or weak token
  return safeEqual(candidate, expected);
}

export function createSession(now = Date.now(), secret = config.sessionSecret): string {
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const payload = String(now + SESSION_TTL_MS);
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * `notBefore` (ms): sessions issued before this moment are rejected, which is how "sign out" ends sessions
 * server-side and not just in the browser that clicked it.
 */
export function verifySession(
  cookie: string | undefined,
  now = Date.now(),
  secret = config.sessionSecret,
  notBefore = 0,
): boolean {
  if (!cookie || !secret) return false;
  const [payload, mac] = cookie.split('.');
  if (!payload || !mac) return false;
  if (!safeEqual(mac, sign(payload, secret))) return false;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires <= now) return false;
  return expires - SESSION_TTL_MS >= notBefore; // issue time is expiry minus the fixed lifetime
}
