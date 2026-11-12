import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { checkHealth } from '../lib/health';

// Used by the Docker HEALTHCHECK. Returns no details, so it leaks nothing to the public internet.
export const GET: APIRoute = () => {
  const { ok, status } = checkHealth(getDb);
  return new Response(JSON.stringify({ status }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
