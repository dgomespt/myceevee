import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAvatarClient, fetchablePhotoUrl, gravatarHash } from '../src/lib/avatar';

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

describe('fetchablePhotoUrl', () => {
  const allowed = (address: string) => fetchablePhotoUrl(address, 'https://grav.test') !== null;

  it('allows https Gravatar addresses, including its numbered and named subdomains', () => {
    for (const ok of [
      'https://gravatar.com/avatar/abc', 'https://1.gravatar.com/avatar/abc?s=200&d=mp',
      'https://secure.gravatar.com/avatar/abc', 'https://www.GRAVATAR.com/avatar/abc',
    ]) expect(allowed(ok), ok).toBe(true);
  });

  it('allows the origin set as GRAVATAR_BASE_URL', () => {
    expect(allowed('https://grav.test/avatar/abc')).toBe(true);
    expect(fetchablePhotoUrl('http://localhost:9999/avatar/abc', 'http://localhost:9999')).not.toBeNull();
  });

  it('refuses every other address, so gist content can never steer the server to a host of its choosing', () => {
    for (const bad of [
      'http://gravatar.com/avatar/abc',                 // not https
      'https://example.com/me.png',
      'https://notgravatar.com/avatar/abc',             // lookalikes
      'https://gravatar.com.evil.example/avatar/abc',
      'https://evil.example/gravatar.com/avatar/abc',
      'https://gravatar.com@evil.example/avatar/abc',   // userinfo trick: the real host is evil.example
      'https://user:pw@gravatar.com/avatar/abc',
      'https://grav.test:8443/avatar/abc',              // other port on the configured host
      'http://localhost:4321/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/', 'https://[::1]/x',
      'file:///etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '',
    ]) expect(allowed(bad), bad).toBe(false);
  });
});

describe('avatar client: photo addresses', () => {
  const address = 'https://1.gravatar.com/avatar/abc123?s=200&d=mp';

  it('fetches an allowed address exactly as given and inlines it', async () => {
    const { c, calls } = client(() => img());
    expect(await c.getUrl(address)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    expect(calls).toEqual([address]);
  });

  it('refuses other addresses without making any request', async () => {
    const { c, calls } = client(() => img());
    expect(await c.getUrl('https://example.com/me.png')).toBeNull();
    expect(await c.getUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(await c.getUrl(undefined)).toBeNull();
    expect(await c.getUrl('')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('caches per address, separately from the email lookup', async () => {
    const { c, calls } = client(() => img());
    await c.getUrl(address); await c.getUrl(address);
    expect(calls).toHaveLength(1);
    await c.get('a@b.co');
    expect(calls).toHaveLength(2);
    await c.getUrl('https://2.gravatar.com/avatar/other');
    expect(calls).toHaveLength(3);
  });

  it('applies the same type and size limits as the email lookup', async () => {
    expect(await client(() => img('text/html')).c.getUrl(address)).toBeNull();
    expect(await client(() => img('image/png', new Uint8Array(200_001))).c.getUrl(address)).toBeNull();
    expect(await client(() => { throw new Error('offline'); }).c.getUrl(address)).toBeNull();
  });
});
