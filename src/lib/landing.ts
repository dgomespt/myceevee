import { avatar } from './avatar';
import { displayUrl, profileIcon, safeUrl } from './format';
import { gist } from './gist';
import type { Resume } from './resume';

export interface LandingLink { kind: 'web' | 'github' | 'linkedin'; href: string; text: string }
export interface LandingProfile {
  name?: string;
  label?: string;
  photo?: string;
  links: LandingLink[];
}

const URL_FOR = {
  github: (user: string) => `https://github.com/${encodeURIComponent(user)}`,
  linkedin: (user: string) => `https://www.linkedin.com/in/${encodeURIComponent(user)}`,
} as const;

/**
 * What the public landing page may show about you: name, title, photo and three kinds of link (web, GitHub, LinkedIn).
 * It is built from an allow-list, so email, phone and postal address can never reach this page.
 */
export function buildLandingProfile(resume: Resume, photo?: string | null): LandingProfile {
  const b = resume.basics ?? {};
  const links: LandingLink[] = [];

  const web = safeUrl(b.url);
  if (web) links.push({ kind: 'web', href: web, text: displayUrl(web) });

  for (const kind of ['github', 'linkedin'] as const) {
    const p = (b.profiles ?? []).find((x) => profileIcon(x) === kind);
    if (!p) continue;
    const href = safeUrl(p.url) ?? (p.username?.trim() ? URL_FOR[kind](p.username.trim()) : undefined);
    if (href) links.push({ kind, href, text: p.username?.trim() || displayUrl(href) });
  }

  return {
    name: b.name?.trim() || undefined,
    label: b.label?.trim() || undefined,
    photo: photo ?? safeUrl(b.image) ?? undefined,
    links,
  };
}

/** Loads the profile for the landing page from the (cached) gist. Null when no CV can be loaded: the page then stays generic. */
export async function loadLanding(): Promise<LandingProfile | null> {
  for (const key of ['full', 'one-page'] as const) {
    const r = await gist.load(key);
    if (r.ok) return buildLandingProfile(r.resume, safeUrl(r.resume.basics?.image) ?? (await avatar.get(r.resume.basics?.email)));
  }
  return null;
}
