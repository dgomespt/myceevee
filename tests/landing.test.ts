import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/lib/config';
import { buildLandingProfile } from '../src/lib/landing';
import type { Resume } from '../src/lib/resume';

const full: Resume = {
  basics: {
    name: ' Ada Lovelace ', label: 'Analyst', email: 'ada@example.com', phone: '+44 20 7946 0000',
    url: 'https://www.ada.example/', image: 'https://img.example/ada.png',
    location: { address: '10 Private Street', city: 'London', postalCode: 'N1 1AA', countryCode: 'GB' },
    profiles: [
      { network: 'Mastodon', username: '@ada', url: 'https://hachyderm.io/@ada' },
      { network: 'GitHub', username: 'ada', url: 'https://github.com/ada' },
      { network: 'LinkedIn', username: 'ada-l', url: 'https://www.linkedin.com/in/ada-l' },
    ],
  },
  work: [{ name: 'Babbage & Co' }],
};

describe('buildLandingProfile', () => {
  it('shows name, label and exactly web + GitHub + LinkedIn links, in that order', () => {
    const p = buildLandingProfile(full);
    expect(p.name).toBe('Ada Lovelace');
    expect(p.label).toBe('Analyst');
    expect(p.links.map((l) => l.kind)).toEqual(['web', 'github', 'linkedin']);
    expect(p.links[0]).toEqual({ kind: 'web', href: 'https://www.ada.example/', text: 'ada.example' });
    expect(p.links[1]).toMatchObject({ href: 'https://github.com/ada', text: 'ada' });
  });

  it('never exposes email, phone or any part of the address, anywhere in the result', () => {
    const json = JSON.stringify(buildLandingProfile(full, 'data:image/png;base64,xx'));
    for (const secret of ['ada@example.com', '+44', '7946', 'Private Street', 'N1 1AA', 'London', 'Babbage', 'Mastodon', 'hachyderm']) {
      expect(json).not.toContain(secret);
    }
  });

  it('builds a GitHub/LinkedIn link from the username when the profile has no url', () => {
    const p = buildLandingProfile({ basics: { profiles: [{ network: 'github', username: 'a b/c' }, { network: 'LinkedIn', username: 'ada-l' }] } });
    expect(p.links).toEqual([
      { kind: 'github', href: 'https://github.com/a%20b%2Fc', text: 'a b/c' },
      { kind: 'linkedin', href: 'https://www.linkedin.com/in/ada-l', text: 'ada-l' },
    ]);
  });

  it('drops unsafe links but keeps the rest', () => {
    const p = buildLandingProfile({ basics: { url: 'javascript:alert(1)', profiles: [{ network: 'GitHub', url: 'data:text/html,x' }, { network: 'LinkedIn', username: 'ok' }] } });
    expect(p.links.map((l) => l.kind)).toEqual(['linkedin']);
    expect(JSON.stringify(p)).not.toMatch(/javascript:|data:/);
  });

  it('prefers the given (inlined) photo over basics.image, and copes with an empty resume', () => {
    expect(buildLandingProfile(full, 'data:image/png;base64,AA').photo).toBe('data:image/png;base64,AA');
    expect(buildLandingProfile(full).photo).toBe('https://img.example/ada.png');
    expect(buildLandingProfile({})).toEqual({ name: undefined, label: undefined, photo: undefined, links: [] });
  });
});

describe('HOME_REDIRECT_URL setting', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('is undefined when unset or blank', () => {
    vi.stubEnv('HOME_REDIRECT_URL', '   ');
    expect(config.homeRedirectUrl).toBeUndefined();
  });
  it('accepts http(s) URLs', () => {
    vi.stubEnv('HOME_REDIRECT_URL', 'https://www.linkedin.com/in/ada');
    expect(config.homeRedirectUrl).toBe('https://www.linkedin.com/in/ada');
  });
  it('ignores anything else, with a one-time warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('HOME_REDIRECT_URL', 'javascript:alert(1)');
    expect(config.homeRedirectUrl).toBeUndefined();
    expect(config.homeRedirectUrl).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
