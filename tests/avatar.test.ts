import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAvatarClient, gravatarHash } from '../src/lib/avatar';

const png = new Uint8Array(new ArrayBuffer(7)); png.set([137, 80, 78, 71, 1, 2, 3]);
const base = () => 'https://grav.test';

function client(handler: (url: string) => Response | Promise<Response>, extra: Parameters<typeof createAvatarClient>[0] = {}) {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => { calls.push(String(url)); return handler(String(url)); }) as typeof fetch;
  return { calls, c: createAvatarClient({ fetch: f, base, ...extra }) };
}
const img = (type = 'image/png', body: Uint8Array<ArrayBuffer> = png) => new Response(body, { headers: { 'content-type': type } });

describe('gravatarHash', () => {
  it('is the sha256 of the trimmed, lowercased email', () => {
    const want = createHash('sha256').update('ada@example.com').digest('hex');
    expect(gravatarHash('  Ada@Example.COM ')).toBe(want);
  });
});

describe('avatar client', () => {
  it('returns an inlined data URI and asks Gravatar for a 404 instead of a default image', async () => {
    const { c, calls } = client(() => img());
    const out = await c.get('Ada@example.com');
    expect(out).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    expect(calls[0]).toContain(`/avatar/${gravatarHash('ada@example.com')}?`);
    expect(calls[0]).toContain('d=404');
    expect(calls[0]).not.toContain('ada@example.com');
  });

  it('returns null without calling out when there is no email', async () => {
    const { c, calls } = client(() => img());
    expect(await c.get(undefined)).toBeNull();
    expect(await c.get('  ')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('caches hits, and caches misses for a shorter time', async () => {
    let t = 0;
    const hit = client(() => img(), { now: () => t, hitTtlMs: 1000, missTtlMs: 100 });
    await hit.c.get('a@b.co'); await hit.c.get('a@b.co');
    expect(hit.calls).toHaveLength(1);
    t = 1001; await hit.c.get('a@b.co');
    expect(hit.calls).toHaveLength(2);

    t = 0;
    const miss = client(() => new Response('', { status: 404 }), { now: () => t, hitTtlMs: 1000, missTtlMs: 100 });
    expect(await miss.c.get('a@b.co')).toBeNull(); await miss.c.get('a@b.co');
    expect(miss.calls).toHaveLength(1);
    t = 101; await miss.c.get('a@b.co');
    expect(miss.calls).toHaveLength(2);
  });

  it('rejects non-image types, oversized bodies and network errors', async () => {
    expect(await client(() => img('text/html')).c.get('a@b.co')).toBeNull();
    expect(await client(() => img('image/svg+xml')).c.get('a@b.co')).toBeNull();
    expect(await client(() => img('image/png', new Uint8Array(200_001))).c.get('a@b.co')).toBeNull();
    expect(await client(() => { throw new Error('offline'); }).c.get('a@b.co')).toBeNull();
  });

  it('keeps the last good photo when a refresh fails, and refresh() clears the cache', async () => {
    let t = 0; let fail = false;
    const { c, calls } = client(() => (fail ? new Response('', { status: 500 }) : img()), { now: () => t, hitTtlMs: 10 });
    const first = await c.get('a@b.co');
    t = 100; fail = true;
    expect(await c.get('a@b.co')).toBe(first);
    c.refresh(); t = 200;
    await c.get('a@b.co');
    expect(calls).toHaveLength(3);
  });
});
