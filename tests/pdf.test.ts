import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pdfFileName, pdfText, renderResumePdf } from '../src/lib/pdf';
import { cvPdfResponse } from '../src/lib/pdfResponse';
import type { Resume } from '../src/lib/resume';
import { fullResume } from './fixtures';

// The response helper asks for a Gravatar; never let a unit test reach the network.
const { get, getUrl } = vi.hoisted(() => ({
  get: vi.fn<(email?: string) => Promise<string | null>>(async () => null),
  getUrl: vi.fn<(address?: string) => Promise<string | null>>(async () => null),
}));
vi.mock('../src/lib/avatar', () => ({ avatar: { get, getUrl } }));

const render = (resume: Resume, opts: Parameters<typeof renderResumePdf>[1] = {}) => renderResumePdf(resume, { compress: false, ...opts });

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const linkCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype\s*\/Link/g) ?? []).length;
/** The content stream of every page that has text on it, as written (uncompressed PDFs only). Skips images and the trailer. */
const contentStreams = (pdf: Buffer): string[] =>
  [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => m[1]!).filter((s) => /\nBT\n/.test(s));
/** The text drawn on each page, one string per page: pdfkit writes it as hex strings in Windows-1252. */
const pageTexts = (pdf: Buffer): string[] => {
  const win1252 = new TextDecoder('windows-1252');
  return contentStreams(pdf).map((s) => [...s.matchAll(/<([0-9a-f]+)>/gi)].map((m) => win1252.decode(Buffer.from(m[1]!, 'hex'))).join(''));
};
const textOf = (pdf: Buffer) => pageTexts(pdf).join('\n');
/** A document-info entry such as Title. pdfkit writes each as its own object (`/Author 14 0 R`), in UTF-16 when not plain ASCII. */
const infoField = (pdf: Buffer, field: string): string | undefined => {
  const raw = pdf.toString('latin1');
  const ref = new RegExp(`/${field} (\\d+) 0 R`).exec(raw);
  const obj = ref && new RegExp(`\\n${ref[1]} 0 obj\\n([\\s\\S]*?)\\nendobj`).exec(raw);
  if (!obj) return undefined;
  const value = obj[1]!.trim();
  const bytes = value.startsWith('<') ? Buffer.from(value.slice(1, -1), 'hex') : Buffer.from(value.slice(1, -1), 'latin1');
  return bytes[0] === 0xfe && bytes[1] === 0xff ? Buffer.from(bytes.subarray(2)).swap16().toString('utf16le') : bytes.toString('latin1');
};
/** Every font size set in the page content. */
const fontSizes = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\/F\d+\s+([\d.]+)\s+Tf/g)].map((m) => Number(m[1]));

const job = (i: number) => ({
  name: `Company ${i}`,
  position: 'Engineer',
  startDate: '2015-01',
  endDate: '2018-01',
  summary: 'Built and ran things for customers, and wrote about it. '.repeat(2),
  highlights: ['Cut the build time by half', 'Mentored three engineers', 'Moved the service to a new platform'],
});

describe('renderResumePdf', () => {
  it('produces an A4 PDF document', async () => {
    const pdf = await render(fullResume);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    expect(pageCount(pdf)).toBe(1);
  });

  it('draws the resume content with the web CV’s headings and date format', async () => {
    const text = textOf(await render(fullResume));
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Programmer');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('SUMMARY');
    expect(text).toContain('Analytical engines.');
    expect(text).toContain('EXPERIENCE');
    expect(text).toContain('Analyst, Babbage & Co');
    expect(text).toContain('Jan 1842 – Present');
    expect(text).toContain('Wrote the first program');
  });

  it('draws sections in the given order and leaves out the others', async () => {
    const text = textOf(await render(fullResume, { order: ['work', 'summary'] }));
    expect(text.indexOf('EXPERIENCE')).toBeGreaterThan(-1);
    expect(text.indexOf('EXPERIENCE')).toBeLessThan(text.indexOf('SUMMARY'));

    const onlySummary = textOf(await render(fullResume, { order: ['summary'] }));
    expect(onlySummary).toContain('SUMMARY');
    expect(onlySummary).not.toContain('EXPERIENCE');
  });

  it('shows every section type', async () => {
    const resume: Resume = {
      basics: { name: 'Ada', location: { city: 'London', countryCode: 'GB' }, phone: '+44 20 0000 0000', profiles: [{ network: 'GitHub', username: 'ada-gh', url: 'https://github.com/ada-gh' }, { network: 'Mastodon', username: '@ada' }] },
      projects: [{ name: 'Engine', description: 'A machine', keywords: ['gears', 'steam'], startDate: '1843' }],
      education: [{ institution: 'Home school', studyType: 'BSc', area: 'Maths', score: '1st', courses: ['Algebra', 'Calculus'] }],
      skills: [{ name: 'Languages', keywords: ['Analytical', 'Bernoulli'] }],
      volunteer: [{ organization: 'Royal Society', position: 'Member', summary: 'Helped out' }],
      certificates: [{ name: 'Notes', issuer: 'Menabrea', date: '1843-07' }],
      awards: [{ title: 'Honour', awarder: 'Queen', date: '1850', summary: 'For services' }],
      publications: [{ name: 'Sketch', publisher: 'Taylor', releaseDate: '1843-10' }],
      languages: [{ language: 'English', fluency: 'Native' }, { language: 'French' }],
      interests: [{ name: 'Poetry' }, { name: 'Horses' }],
      references: [{ name: 'C. Babbage', reference: 'Brilliant.' }],
    };
    const text = textOf(await render(resume));
    for (const wanted of [
      'London, GB', '+44 20 0000 0000', 'ada-gh', 'Mastodon: @ada',
      'PROJECTS', 'Engine', 'gears · steam', 'EDUCATION', 'BSc, Maths, Home school', 'Score: 1st', 'Algebra · Calculus',
      'SKILLS', 'Languages', 'Analytical, Bernoulli', 'VOLUNTEERING', 'Member, Royal Society',
      'CERTIFICATES', 'Notes — Menabrea', 'Jul 1843', 'AWARDS', 'Honour — Queen', 'For services', 'PUBLICATIONS', 'Sketch — Taylor',
      'LANGUAGES', 'English (Native) · French', 'INTERESTS', 'Poetry · Horses', 'REFERENCES', 'Brilliant.', 'C. Babbage',
    ]) {
      expect(text, wanted).toContain(wanted);
    }
  });

  it('runs a long full CV onto further pages', async () => {
    const resume: Resume = { basics: { name: 'Ada' }, work: Array.from({ length: 30 }, (_, i) => job(i)) };
    expect(pageCount(await render(resume))).toBeGreaterThan(2);
  });

  it('keeps every entry whole instead of splitting it across two pages', async () => {
    // Every entry has one heading ("Company n") and one last bullet. If an entry were cut between pages, one page would
    // show a heading without its last bullet and the next a last bullet without its heading, so the counts would differ.
    const entries = 30;
    const pdf = await render({ basics: { name: 'Ada' }, work: Array.from({ length: entries }, (_, i) => job(i)) });
    const count = (text: string, part: string) => text.split(part).length - 1;
    const withEntries = pageTexts(pdf).filter((t) => t.includes('Company '));
    expect(withEntries.length).toBeGreaterThan(1);
    for (const page of withEntries) expect(count(page, 'Company ')).toBe(count(page, 'Moved the service to a new platform'));
    expect(withEntries.reduce((sum, page) => sum + count(page, 'Company '), 0)).toBe(entries);
  });

  it('never leaves a section heading alone at the bottom of a page', async () => {
    // Pad the first page so that a heading would land right at the bottom, then check each page ends on content.
    for (let filler = 20; filler <= 40; filler++) {
      const pdf = await render({
        basics: { name: 'Ada' },
        work: Array.from({ length: filler }, (_, i) => job(i)),
        education: [{ institution: 'School', studyType: 'BSc', area: 'Maths' }],
      });
      // Ignore what is drawn after the content: the running header's name on later pages, then the "Page x of y" footer.
      for (const page of pageTexts(pdf)) expect(page.replace(/(Ada)?Page \d+ of \d+$/, '').trimEnd().endsWith('EDUCATION'), `filler ${filler}`).toBe(false);
    }
  });

  it('keeps the skills table whole, with its heading, wherever the page break falls', async () => {
    const skills = Array.from({ length: 7 }, (_, i) => ({ name: `Skill ${i}`, keywords: [`keyword ${i}`, 'and another one'] }));
    let split = 0;
    for (let jobs = 6; jobs <= 20; jobs++) {
      const pdf = await render({ basics: { name: 'Ada' }, work: Array.from({ length: jobs }, (_, i) => job(i)), skills });
      const rowsOnPage = pageTexts(pdf).map((t) => t.split('Skill ').length - 1);
      for (const [i, rows] of rowsOnPage.entries()) {
        expect([0, 7], `${jobs} jobs, page ${i + 1} holds ${rows} of 7 skill rows`).toContain(rows);
        if (rows === 7) expect(pageTexts(pdf)[i], `${jobs} jobs`).toContain('SKILLS');
      }
      if (rowsOnPage.length > 1) split++;
    }
    expect(split).toBeGreaterThan(5); // the loop did exercise page breaks
  });

  describe('header on later pages', () => {
    const cv = (jobs: number): Resume => ({
      basics: {
        name: 'Ada', email: 'ada@example.com', url: 'https://www.ada.example.com/', location: { city: 'London' }, phone: '+44 1',
        profiles: [
          { network: 'GitHub', username: 'ada-gh', url: 'https://github.com/ada-gh' },
          { network: 'LinkedIn', username: 'ada-li', url: 'https://www.linkedin.com/in/ada-li/' },
        ],
      },
      work: Array.from({ length: jobs }, (_, i) => job(i)),
    });
    /** Heights of the text lines on a page, in PDF points up from the bottom edge, highest first. */
    const lineHeights = (stream: string) => [...new Set([...stream.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map((m) => Number(m[1])))].sort((a, b) => b - a);

    it('starts every page after the first with the name and the addresses written out, and leaves page 1 as it was', async () => {
      const [first, ...later] = pageTexts(await render(cv(30)));
      expect(later.length).toBeGreaterThan(1);
      // Page 1 keeps the web header: icons and handles, not addresses.
      expect(first).toContain('ada-gh');
      expect(first).not.toContain('github.com');
      expect(first).not.toContain('linkedin.com');
      for (const page of later) {
        for (const shown of ['Ada', 'ada@example.com', 'ada.example.com', 'github.com/ada-gh', 'linkedin.com/in/ada-li']) expect(page, shown).toContain(shown);
        expect(page).not.toContain('https://'); // no scheme, no "www.", no trailing slash: just the address
        expect(page).not.toContain('www.');
        expect(page).not.toContain('London');   // only the name and links, not location or phone
        expect(page).not.toContain('+44');
      }
    });

    it('keeps those addresses clickable on screen', async () => {
      const pdf = await render(cv(30));
      // Four links in the page 1 header (email, website, GitHub, LinkedIn), and the same four in each later header.
      expect(linkCount(pdf)).toBe(4 * pageCount(pdf));
    });

    it('adds nothing to a single page', async () => {
      const pdf = await render(cv(1));
      expect(pageCount(pdf)).toBe(1);
      expect(textOf(pdf)).not.toContain('github.com');
      expect(linkCount(pdf)).toBe(4);
    });

    it('starts the content below the header on every later page', async () => {
      const [, ...later] = contentStreams(await render(cv(30)));
      expect(later.length).toBeGreaterThan(1);
      // The highest line is the header; the next is the first line of content. Between them sit the rule and some space.
      for (const stream of later) {
        const [header, content] = lineHeights(stream);
        expect(header! - content!).toBeGreaterThan(20);
      }
    });

    it('also keeps pages that pdfkit starts by itself, inside one very long paragraph, below the header', async () => {
      const pdf = await render({ ...cv(0), basics: { ...cv(0).basics, summary: 'lorem '.repeat(4000) } });
      const [, ...later] = contentStreams(pdf);
      expect(later.length).toBeGreaterThan(2);
      for (const stream of later) {
        const [header, content] = lineHeights(stream);
        expect(header! - content!, 'text must not start underneath the header').toBeGreaterThan(20);
      }
    });

    it('has no header to show when the CV has no name and no addresses, and then pages start at the top as before', async () => {
      const pdf = await render({ work: Array.from({ length: 30 }, (_, i) => job(i)) });
      const [, ...later] = contentStreams(pdf);
      expect(later.length).toBeGreaterThan(1);
      for (const stream of later) {
        const [first, second] = lineHeights(stream);
        expect(first! - second!).toBeLessThan(20); // ordinary lines of content, no gap for a header
      }
    });

    it('lists a profile that has no address as "Network: handle"', async () => {
      const resume = { ...cv(30), basics: { ...cv(30).basics, profiles: [{ network: 'Mastodon', username: '@ada' }] } };
      const [, ...later] = pageTexts(await render(resume));
      for (const page of later) expect(page).toContain('Mastodon: @ada');
    });

    it('wraps onto further rows, all above the content, when there are many addresses', async () => {
      const profiles = Array.from({ length: 8 }, (_, i) => ({ network: 'Site', username: `s${i}`, url: `https://example${i}.example/a-fairly-long-path-${i}` }));
      const [, ...later] = contentStreams(await render({ ...cv(30), basics: { ...cv(30).basics, profiles } }));
      expect(later.length).toBeGreaterThan(1);
      for (const stream of later) {
        const heights = lineHeights(stream);
        // Header rows sit about one line apart; the first bigger jump is the step down to the content.
        const jump = heights.findIndex((y, i) => i < heights.length - 1 && y - heights[i + 1]! > 20);
        expect(jump, 'at least two header rows, then a gap, then content').toBeGreaterThanOrEqual(1);
        expect(heights[0]! - heights[1]!).toBeLessThan(20);
      }
    });
  });

  describe('page numbers', () => {
    const longCv = (jobs: number): Resume => ({ basics: { name: 'Ada' }, work: Array.from({ length: jobs }, (_, i) => job(i)) });
    const footers = (pdf: Buffer) => textOf(pdf).match(/Page \d+ of \d+/g) ?? [];

    it('numbers every page of a long CV as "Page x of y"', async () => {
      const pdf = await render(longCv(30));
      const pages = pageCount(pdf);
      expect(pages).toBeGreaterThan(2);
      expect(footers(pdf)).toEqual(Array.from({ length: pages }, (_, i) => `Page ${i + 1} of ${pages}`));
    });

    it('leaves a single page without a counter', async () => {
      expect(footers(await render(fullResume))).toEqual([]);
      expect(footers(await render(fullResume, { variant: 'one-page' }))).toEqual([]);
      expect(textOf(await render({}))).not.toContain('Page ');
    });

    it('numbers a one-page CV that had to run onto a second page', async () => {
      const pdf = await render(longCv(40), { variant: 'one-page' });
      const pages = pageCount(pdf);
      expect(pages).toBeGreaterThan(1);
      expect(footers(pdf)).toEqual(Array.from({ length: pages }, (_, i) => `Page ${i + 1} of ${pages}`));
    });

    it('does not add pages of its own: the footer sits in the margin, below the content', async () => {
      // Whatever fills the last page, the footer must not spill onto an extra, otherwise empty page.
      for (let jobs = 8; jobs <= 16; jobs++) {
        const pdf = await render(longCv(jobs));
        const pages = pageTexts(pdf);
        expect(pages.length, `${jobs} jobs`).toBe(pageCount(pdf)); // no page without text, so none that holds only a footer
        expect(pages.at(-1), `${jobs} jobs`).toContain('Company');
        expect(footers(pdf).at(-1), `${jobs} jobs`).toBe(`Page ${pages.length} of ${pages.length}`);
      }
    });

    it('draws the footer in the bottom margin: below the content area and still on the paper', async () => {
      // pdfkit writes a text position as "1 0 0 1 x y Tm" with y in PDF points measured up from the bottom edge. The footer
      // is the last text on each page; the content area ends 40 pt above the bottom edge, so it must be below that line.
      const footerYs = contentStreams(await render(longCv(30))).map((s) => Number([...s.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].at(-1)?.[1]));
      expect(footerYs.length).toBeGreaterThan(2);
      for (const y of footerYs) {
        expect(y).toBeLessThan(40);
        expect(y).toBeGreaterThan(8);
      }
    });
  });

  describe('one-page variant', () => {
    it('is a single page for an ordinary CV', async () => {
      expect(pageCount(await render(fullResume, { variant: 'one-page' }))).toBe(1);
    });

    // The largest size under 12 pt is the entry titles: it leaves out the name, and it moves with the shrink factor.
    const titleSize = (pdf: Buffer) => Math.max(...fontSizes(pdf).filter((s) => s < 12));
    const cvOf = (jobs: number): Resume => ({ basics: { name: 'Ada' }, work: Array.from({ length: jobs }, (_, i) => job(i)) });

    it('shrinks its text to fit one page rather than spilling over', async () => {
      const normal = titleSize(await render(cvOf(1), { variant: 'one-page' }));
      // Some amount of content is too tall at full size yet fits once shrunk: find it by adding entries.
      let shrunk = false;
      for (let jobs = 3; jobs <= 30 && !shrunk; jobs++) {
        const pdf = await render(cvOf(jobs), { variant: 'one-page' });
        shrunk = pageCount(pdf) === 1 && titleSize(pdf) < normal;
      }
      expect(shrunk).toBe(true);
    });

    it('gives up shrinking at a readable size and uses a second page', async () => {
      const pdf = await render(cvOf(40), { variant: 'one-page' });
      expect(pageCount(pdf)).toBeGreaterThan(1);
      expect(titleSize(pdf)).toBeGreaterThanOrEqual(8);
    });

    it('does not shrink the full CV', async () => {
      const full = titleSize(await render(cvOf(40), { variant: 'full' }));
      expect(full).toBe(10.5);
    });
  });

  describe('links', () => {
    it('links the email, the website and linked entries, one link per item', async () => {
      const pdf = await render({
        basics: { name: 'Ada', email: 'ada@example.com', url: 'https://ada.example.com', profiles: [{ network: 'GitHub', username: 'ada', url: 'https://github.com/ada' }] },
        work: [{ name: 'Babbage & Co', position: 'Analyst', url: 'https://babbage.example.com', startDate: '1842' }],
      });
      const raw = pdf.toString('latin1');
      for (const uri of ['mailto:ada@example.com', 'https://ada.example.com', 'https://github.com/ada', 'https://babbage.example.com']) {
        expect(raw, uri).toContain(uri);
      }
      expect(linkCount(pdf)).toBe(4);
    });

    it('never links anything but http(s) addresses', async () => {
      const pdf = await render({ basics: { name: 'Ada', url: 'javascript:alert(1)' }, work: [{ name: 'X', url: 'data:text/html,hi' }] });
      expect(pdf.toString('latin1')).not.toContain('javascript:');
      expect(pdf.toString('latin1')).not.toContain('data:text');
      expect(linkCount(pdf)).toBe(0);
    });
  });

  describe('header icons', () => {
    // How each icon starts in the page content (see ICONS in src/lib/pdf.ts). pdfkit turns the globe's arcs into curves.
    const SIGNATURE = {
      github: /\n12 0\.297 m\n/,
      linkedin: /\n20\.447 20\.452 m\n/,
      email: /\n22 6 m\n12 13 l\n2 6 l\n/,
      'map-pin': /\n21 10 m\n21 17 12 23 12 23 c\n/,
      web: /\n22 12 m\n22 17\.522847 17\.522847 22 12 22 c\n/,
    };
    const iconsIn = (pdf: Buffer) => Object.entries(SIGNATURE).filter(([, re]) => re.test(pdf.toString('latin1'))).map(([name]) => name).sort();

    it('puts an icon before the location, email, website, GitHub and LinkedIn entries, like the web header', async () => {
      const pdf = await render({
        basics: {
          name: 'Ada', location: { city: 'London' }, email: 'ada@example.com', url: 'https://ada.example.com',
          profiles: [{ network: 'GitHub', username: 'ada' }, { network: 'LinkedIn', username: 'ada-l', url: 'https://www.linkedin.com/in/ada-l' }],
        },
      });
      expect(iconsIn(pdf)).toEqual(['email', 'github', 'linkedin', 'map-pin', 'web']);
      // The icon replaces the network's name: the handle alone is shown.
      const text = textOf(pdf);
      expect(text).toContain('ada-l');
      expect(text).not.toContain('GitHub:');
      expect(text).not.toContain('LinkedIn:');
    });

    it('recognises a network by its address when the name says nothing', async () => {
      const pdf = await render({ basics: { name: 'Ada', profiles: [{ network: 'Code', username: 'ada', url: 'https://github.com/ada' }] } });
      expect(iconsIn(pdf)).toEqual(['github']);
    });

    it('draws only the icons whose entries exist; the phone and other networks stay plain text', async () => {
      expect(iconsIn(await render({ basics: { name: 'Ada' } }))).toEqual([]);
      const plain = await render({
        basics: { name: 'Ada', phone: '+44 1', profiles: [{ network: 'Mastodon', username: '@ada', url: 'https://hachyderm.io/@ada' }] },
      });
      expect(iconsIn(plain)).toEqual([]);
      expect(textOf(plain)).toContain('+44 1');
      expect(textOf(plain)).toContain('Mastodon: @ada');
      expect(iconsIn(await render({ basics: { name: 'Ada', email: 'ada@example.com' } }))).toEqual(['email']);
    });

    it('puts a map pin before the location, and none when there is no location to show', async () => {
      const pdf = await render({ basics: { name: 'Ada', location: { city: 'London', countryCode: 'GB' } } });
      expect(iconsIn(pdf)).toEqual(['map-pin']);
      expect(textOf(pdf)).toContain('London, GB');
      expect(iconsIn(await render({ basics: { name: 'Ada', location: {} } }))).toEqual([]);
      expect(iconsIn(await render({ basics: { name: 'Ada', location: 'Mars' as never } }))).toEqual([]);
    });

    it('draws the map pin but no link for it, since a location has no address', async () => {
      const pdf = await render({ basics: { name: 'Ada', location: { city: 'London' } } });
      expect(iconsIn(pdf)).toEqual(['map-pin']);
      expect(linkCount(pdf)).toBe(0);
    });

    it('shows no icon for an entry with nothing to show', async () => {
      const pdf = await render({ basics: { name: 'Ada', email: '  ', profiles: [{ network: 'GitHub' }] } });
      expect(iconsIn(pdf)).toEqual([]);
    });

    it('links the icon and its text together, as one area per entry', async () => {
      const pdf = await render({ basics: { name: 'Ada', email: 'ada@example.com', url: 'https://ada.example.com' } });
      expect(linkCount(pdf)).toBe(2);
    });

    it('wraps a long contact line onto further rows instead of running off the page', async () => {
      const profiles = Array.from({ length: 14 }, (_, i) => ({ network: 'GitHub', username: `a-rather-long-handle-${i}`, url: `https://github.com/h${i}` }));
      const pdf = await render({ basics: { name: 'Ada', email: 'ada@example.com', profiles } });
      const text = textOf(pdf);
      for (let i = 0; i < 14; i++) expect(text).toContain(`a-rather-long-handle-${i}`);
      expect(pageCount(pdf)).toBe(1);
    });

    it('keeps the icons in the one-page variant too', async () => {
      const pdf = await render({ basics: { name: 'Ada', email: 'ada@example.com' } }, { variant: 'one-page' });
      expect(iconsIn(pdf)).toEqual(['email']);
    });
  });

  describe('photo', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const imageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;

    it('embeds a PNG photo', async () => {
      // More than one image object is fine: a PNG with transparency also gets a soft-mask image.
      expect(imageCount(await render(fullResume, { photo: PNG }))).toBeGreaterThan(0);
    });
    it('leaves out photos it cannot embed, without failing', async () => {
      expect(imageCount(await render(fullResume, { photo: 'data:image/webp;base64,AAAA' }))).toBe(0);
      expect(imageCount(await render(fullResume, { photo: 'data:image/png;base64,AAAA' }))).toBe(0); // not really a PNG
      expect(imageCount(await render(fullResume, { photo: 'https://example.com/me.png' }))).toBe(0);
      expect(imageCount(await render(fullResume, { photo: null }))).toBe(0);
    });
    it('still draws the rest of the page when the photo is a damaged image', async () => {
      const damaged = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64');
      expect(textOf(await render(fullResume, { photo: damaged }))).toContain('EXPERIENCE');
    });
  });

  describe('awkward input', () => {
    it('renders an empty resume', async () => {
      const pdf = await render({});
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pageCount(pdf)).toBe(1);
    });

    it('survives loosely typed gist data (nulls, numbers and objects where text belongs)', async () => {
      const messy = {
        basics: { name: 42, label: { x: 1 }, profiles: [null, { network: 7 }, { username: 'ada' }], location: 'Mars' },
        work: [null, 5, 'text', { name: 123, position: null, startDate: { y: 1 }, endDate: 2020, url: 5, highlights: [null, { a: 1 }, 'kept', 9] }],
        skills: [{}, { name: 'Only a name' }, null],
        languages: [null, { language: 'English' }],
        education: 'not a list',
      } as unknown as Resume;
      const text = textOf(await render(messy));
      expect(text).toContain('42');
      expect(text).toContain('kept');
      expect(text).toContain('Only a name');
      expect(text).toContain('English');
    });

    it('prints what the built-in fonts can and swaps the rest for a question mark', async () => {
      const text = textOf(await render({ basics: { name: 'José Müller', summary: 'Olá, mundo – “bom” 日本語 end' } }));
      expect(text).toContain('José Müller');
      expect(text).toContain('Olá, mundo – “bom” ? end');
    });

    it('does not let a long unbroken word or a very long entry break the layout', async () => {
      const resume: Resume = { basics: { name: 'Ada', summary: 'x'.repeat(400) }, work: [{ name: 'Y'.repeat(200), position: 'Z'.repeat(120), highlights: ['w'.repeat(500)] }] };
      expect(pageCount(await render(resume))).toBeGreaterThanOrEqual(1);
    });
  });

  it('sets the document title, author and producer, and asks viewers to show the title', async () => {
    const pdf = await render(fullResume);
    expect(infoField(pdf, 'Title')).toBe('Ada Lovelace – Full CV');
    expect(infoField(pdf, 'Author')).toBe('Ada Lovelace');
    expect(infoField(pdf, 'Subject')).toBe('Programmer');
    expect(infoField(pdf, 'Creator')).toBe('myceevee');
    expect(infoField(pdf, 'Producer')).toBe('myceevee');
    expect(pdf.toString('latin1')).toContain('/DisplayDocTitle true');
  });

  it('leaves out author and subject when the CV has none', async () => {
    const pdf = await render({});
    expect(infoField(pdf, 'Title')).toBe('Full CV');
    expect(infoField(pdf, 'Author')).toBeUndefined();
    expect(infoField(pdf, 'Subject')).toBeUndefined();
  });
});

describe('pdfText', () => {
  it('collapses whitespace the way HTML does', () => {
    expect(pdfText('  a\n\n  b\t c ')).toBe('a b c');
  });
  it('keeps accents and typographic punctuation', () => {
    expect(pdfText('Café – “quoted” … €5 ç ã')).toBe('Café – “quoted” … €5 ç ã');
  });
  it('replaces a run of unprintable characters with one question mark and drops invisible ones', () => {
    expect(pdfText('日本語')).toBe('?');
    expect(pdfText('a 😀😀 b')).toBe('a ? b');
    expect(pdfText('x​y')).toBe('xy');
  });
  it('maps look-alike dashes and arrows', () => {
    expect(pdfText('a‑b − c → d')).toBe('a-b - c -> d');
  });
  it('only accepts text and numbers', () => {
    expect(pdfText(42)).toBe('42');
    expect(pdfText(null)).toBe('');
    expect(pdfText({ a: 1 })).toBe('');
    expect(pdfText(undefined)).toBe('');
  });
});

describe('pdfFileName', () => {
  it('builds an ASCII file name from the person’s name', () => {
    expect(pdfFileName('Ada Lovelace', 'full')).toBe('Ada-Lovelace-CV.pdf');
    expect(pdfFileName('Ada Lovelace', 'one-page')).toBe('Ada-Lovelace-CV-one-page.pdf');
    expect(pdfFileName('José  Müller-Ñandú', 'full')).toBe('Jose-Muller-Nandu-CV.pdf');
  });
  it('never lets header-breaking or path characters through', () => {
    expect(pdfFileName('a"b\r\nc/../d', 'full')).toBe('a-b-c-d-CV.pdf');
    expect(pdfFileName('日本語', 'full')).toBe('CV.pdf');
  });
  it('falls back when there is no name', () => {
    expect(pdfFileName(undefined, 'full')).toBe('CV.pdf');
    expect(pdfFileName(undefined, 'one-page')).toBe('CV-one-page.pdf');
  });
});

describe('cvPdfResponse', () => {
  const ok = (resume: Resume) => ({ ok: true as const, resume, warnings: [], order: ['summary', 'work'] as const });
  beforeEach(() => { get.mockClear(); getUrl.mockClear(); });
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const hasImage = async (res: Response) => /\/Subtype\s*\/Image/.test(Buffer.from(await res.arrayBuffer()).toString('latin1'));

  it('answers with the PDF, named after the person', async () => {
    const res = await cvPdfResponse('full', ok(fullResume));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="Ada-Lovelace-CV.pdf"');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers.get('content-length')).toBe(String(body.length));
  });

  it('says 503 when the CV could not be loaded', async () => {
    const res = await cvPdfResponse('full', { ok: false, error: 'gist is down' });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('reuses a finished PDF for identical content and rebuilds when the content changes', async () => {
    const bytes = async (r: Resume) => Buffer.from(await (await cvPdfResponse('full', ok(r))).arrayBuffer());
    const first = await bytes({ basics: { name: 'Cache Test' } });
    expect((await bytes({ basics: { name: 'Cache Test' } })).equals(first)).toBe(true);
    expect((await bytes({ basics: { name: 'Cache Test Changed' } })).equals(first)).toBe(false);
  });

  describe('photo, chosen the way the web CV chooses it', () => {
    it('uses the Gravatar for the email when the CV has no photo address', async () => {
      get.mockResolvedValueOnce(PIXEL);
      const res = await cvPdfResponse('full', ok({ basics: { name: 'Email Photo', email: 'a@example.com' } }));
      expect(get).toHaveBeenCalledWith('a@example.com');
      expect(getUrl).not.toHaveBeenCalled();
      expect(await hasImage(res)).toBe(true);
    });

    it('uses the photo address (basics.image) instead of the email when there is one', async () => {
      getUrl.mockResolvedValueOnce(PIXEL);
      const image = 'https://1.gravatar.com/avatar/abc';
      const res = await cvPdfResponse('full', ok({ basics: { name: 'Address Photo', email: 'b@example.com', image } }));
      expect(getUrl).toHaveBeenCalledWith(image);
      expect(get).not.toHaveBeenCalled();
      expect(await hasImage(res)).toBe(true);
    });

    it('has no photo, and does not fall back to the email, when the address cannot be fetched', async () => {
      // getUrl answers null for addresses it refuses (any host that is not Gravatar) or cannot download.
      const res = await cvPdfResponse('full', ok({ basics: { name: 'No Photo', email: 'c@example.com', image: 'https://example.com/c.png' } }));
      expect(getUrl).toHaveBeenCalledTimes(1);
      expect(get).not.toHaveBeenCalled();
      expect(await hasImage(res)).toBe(false);
    });

    it('treats a photo address that is not an http(s) link as absent, as the web CV does', async () => {
      await cvPdfResponse('full', ok({ basics: { name: 'Odd Photo', email: 'd@example.com', image: 'javascript:alert(1)' } }));
      expect(getUrl).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith('d@example.com');
    });
  });
});
