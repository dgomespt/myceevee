import type { Db } from './db';

export type Health = { ok: boolean; status: 'ok' | 'error' };

/**
 * Liveness/readiness for the container: the app is serving and its own database answers.
 * Deliberately does not call GitHub, so a gist outage never gets the container marked unhealthy and restarted.
 */
export function checkHealth(db: () => Db): Health {
  try {
    db().prepare('SELECT 1').get();
    return { ok: true, status: 'ok' };
  } catch {
    return { ok: false, status: 'error' };
  }
}
