import PDFDocument from 'pdfkit';
import { CV_LABELS, type CvKey } from './config';
import { dateRange, displayUrl, formatDate, locationLine, profileIcon, safeUrl } from './format';
import type { Resume } from './resume';
import { ALL_SECTIONS, type SectionKey } from './sections';

// Builds a CV PDF with pdfkit (pure JavaScript: no browser and no system packages, so it runs fine as a non-root user).
// It mirrors src/components/Resume.astro section by section, using the same data helpers, so a CV and its PDF show the
// same content in the same order. The layout is drawn here rather than printed from the web page; keep the two in step.

export interface PdfOptions {
  /** `one-page` shrinks its text, down to a floor, until everything fits on a single A4 sheet. */
  variant?: CvKey;
  /** Sections to draw, in order. Defaults to all of them. */
  order?: readonly SectionKey[];
  /** Photo as a `data:` URI. Only PNG and JPEG can be embedded; anything else is left out. */
  photo?: string | null;
  /** Compress the content streams (on by default). Tests turn it off so they can read the text back. */
  compress?: boolean;
}

// ---- text ---------------------------------------------------------------------------------------------------------

const COLOR = { ink: '#1d2330', muted: '#5b6475', rule: '#d9dce3', accent: '#1f4e8c' } as const;
const REGULAR = 'Helvetica';
const BOLD = 'Helvetica-Bold';
/** pdfkit's line height for Helvetica as a multiple of the font size; used to reach a wanted line height. */
const NATURAL_LINE = 1.156;
/** Helvetica's ascender as a multiple of the font size: where the first baseline sits below the top of a line. */
const ASCENT = 0.718;

/** The characters the built-in PDF fonts can print: Windows-1252 (Western European languages, common punctuation). */
const PRINTABLE = new Set<string>();
{
  const decoder = new TextDecoder('windows-1252');
  for (let byte = 0x20; byte <= 0xff; byte++) {
    const ch = decoder.decode(Uint8Array.of(byte));
    if (!/\p{Cc}/u.test(ch)) PRINTABLE.add(ch);
  }
}

/** Gist content is untrusted and loosely typed: only strings and numbers become text. */
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * Makes text safe for the built-in fonts. Whitespace collapses the way HTML does it (the web CV shows newlines as
 * spaces). Characters those fonts can't print would come out as the wrong glyph, so a run of them becomes a single "?".
 */
function scrub(text: string): string {
  const flat = text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[‐‑−]/g, '-')
    .replace(/→/g, '->');
  let out = '';
  let unknown = false;
  for (const ch of flat) {
    if (PRINTABLE.has(ch)) {
      out += ch;
      unknown = false;
    } else if (/[\p{Cc}\p{Cf}\p{Mn}]/u.test(ch)) {
      continue; // zero-width and leftover combining characters
    } else if (!unknown) {
      out += '?';
      unknown = true;
    }
  }
  return out;
}

export const pdfText = (text: unknown): string => scrub(str(text)).trim();

/** A safe, ASCII-only download name such as "Ada-Lovelace-CV.pdf". */
export function pdfFileName(name: unknown, variant: CvKey): string {
  const person = str(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${[person, variant === 'one-page' ? 'CV-one-page' : 'CV'].filter(Boolean).join('-')}.pdf`;
}

// Icon outlines on a 24 x 24 grid, copied from src/components/Icon.astro so the PDF header matches the web header. GitHub and
// LinkedIn marks: Simple Icons (CC0), drawn filled. Email, globe and map pin: Feather Icons (MIT), drawn as 2-unit round strokes.
const ICONS = {
  github: { fill: ['M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'] },
  linkedin: { fill: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'] },
  email: { stroke: ['M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', 'M22 6L12 13L2 6'] },
  'map-pin': { stroke: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M15 10a3 3 0 1 1-6 0 3 3 0 1 1 6 0z'] },
  web: { stroke: ['M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0z', 'M2 12L22 12', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'] },
} as const;
type PdfIcon = keyof typeof ICONS;

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
function photoBytes(dataUri?: string | null): Buffer | null {
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUri ?? '');
  const bytes = m ? Buffer.from(m[1]!, 'base64') : null;
  const starts = (sig: number[]) => !!bytes && sig.every((b, i) => bytes[i] === b);
  return bytes && (starts(PNG) || starts(JPEG)) ? bytes : null;
}

// ---- layout -------------------------------------------------------------------------------------------------------

interface Metrics {
  marginX: number; marginY: number;
  body: number; small: number; title: number; h1: number; label: number; h2: number;
  /** Line height as a multiple of the font size. */
  line: number;
  sectionGap: number; entryGap: number; photo: number;
}

/** Sizes in points. `s` scales type and spacing (never the page margins) so the one-page CV can shrink to fit. */
function metrics(variant: CvKey, s: number): Metrics {
  const k = (n: number) => Math.round(n * s * 100) / 100;
  return variant === 'one-page'
    ? { marginX: 43, marginY: 37, body: k(9.5), small: k(8.6), title: k(9.8), h1: k(20), label: k(11), h2: k(8), line: 1.35, sectionGap: k(11), entryGap: k(6), photo: k(56) }
    : { marginX: 40, marginY: 40, body: k(10), small: k(9), title: k(10.5), h1: k(24), label: k(12.5), h2: k(8.5), line: 1.4, sectionGap: k(16), entryGap: k(9), photo: k(66) };
}

interface Block { height: number; draw: (y: number) => number }
/** Blocks that stay on one page together, with the space that goes before them (dropped at the top of a page). */
interface Unit { before: number; blocks: Block[] }
interface Seg { text: string; link?: string | undefined; bold?: boolean; color?: string }
interface Style { size: number; color: string; font?: string; line?: number; spacing?: number; align?: 'left' | 'right' }
/** One entry of a row of contact details: an optional icon, then text, the whole thing linked when it has an address. */
interface RowItem { icon?: PdfIcon; text: string; link?: string | undefined; bold?: boolean }

/** Array entries that are objects: loosely typed gist data may hold nulls or strings where a record belongs. */
const records = <T,>(a: T[] | undefined): T[] => (Array.isArray(a) ? a.filter((x) => !!x && typeof x === 'object') : []);
const strings = (a: unknown): string[] => (Array.isArray(a) ? a.map(str).filter((s) => s.trim() !== '') : []);

function renderOnce(resume: Resume, opts: PdfOptions, scale: number): Promise<{ buffer: Buffer; pages: number }> {
  const variant = opts.variant ?? 'full';
  const order = opts.order ?? ALL_SECTIONS;
  const m = metrics(variant, scale);
  const b = resume.basics ?? {};
  const name = str(b.name);
  const label = str(b.label);

  const info: PDFKit.DocumentInfo = { Creator: 'myceevee', Producer: 'myceevee', Title: name ? `${name} – ${CV_LABELS[variant]}` : CV_LABELS[variant] };
  if (name) info.Author = name;
  if (label) info.Subject = label;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: m.marginY, bottom: m.marginY, left: m.marginX, right: m.marginX },
    compress: opts.compress ?? true,
    // Pages stay in memory until the end, so each can be given its "Page x of y" once the total is known.
    bufferPages: true,
    displayTitle: true,
    info,
  });
  let pages = 1;

  const left = m.marginX;
  const width = doc.page.width - 2 * m.marginX;
  const top = m.marginY;
  const bottom = doc.page.height - m.marginY;

  // ---- building blocks: each one measures itself first, so pages can be broken before anything is drawn ----

  const spacer = (height: number): Block => ({ height, draw: (y) => y + height });
  const stack = (blocks: Block[], gap = 0): Block => {
    const shown = blocks.filter((x) => x.height > 0);
    return {
      height: shown.reduce((sum, x, i) => sum + x.height + (i ? gap : 0), 0),
      draw: (y) => shown.reduce((at, x, i) => x.draw(i ? at + gap : at), y),
    };
  };

  /** Text in one style. Segments may differ in link, weight and colour; they flow together as a single paragraph. */
  const text = (input: string | Seg[], st: Style, x: number, w: number): Block => {
    const segs: Seg[] = typeof input === 'string' ? [{ text: input }] : input;
    const parts = segs
      .map((p) => ({ ...p, text: scrub(p.text) }))
      .filter((p) => p.text !== '' && p.text !== ' ');
    const base = st.font ?? REGULAR;
    const lineGap = Math.max(0, st.size * ((st.line ?? m.line) - NATURAL_LINE));
    const layout = { width: w, lineGap, ...(st.spacing ? { characterSpacing: st.spacing } : {}), ...(st.align ? { align: st.align } : {}) };
    // Mixed weights are measured as bold, which is wider: the estimate can only be too tall, never too short.
    doc.font(parts.some((p) => p.bold) ? BOLD : base).fontSize(st.size);
    const height = parts.length ? doc.heightOfString(parts.map((p) => p.text).join(''), layout) : 0;
    return {
      height,
      draw(y) {
        parts.forEach((p, i) => {
          doc.font(p.bold ? BOLD : base).fontSize(st.size).fillColor(p.color ?? st.color);
          // `link: null` stops pdfkit carrying one segment's link over to the next one.
          const o = { ...layout, continued: i < parts.length - 1, link: p.link ?? null };
          if (i === 0) doc.text(p.text, x, y, o);
          else doc.text(p.text, o);
        });
        return parts.length ? doc.y : y;
      },
    };
  };

  const body: Style = { size: m.body, color: COLOR.ink };
  const small: Style = { size: m.small, color: COLOR.muted };
  const para = (v: unknown, st: Style = body, x = left, w = width): Block | null => (str(v).trim() ? text(str(v), st, x, w) : null);
  const meta = (v: unknown) => para(v, small);

  const bullets = (items: string[]): Block | null => {
    if (!items.length) return null;
    const indent = 11 * scale;
    const rows = items.map((t) => text(t, body, left + indent, width - indent));
    const gap = 1.5 * scale;
    const all = stack(rows, gap);
    return {
      height: all.height,
      draw(y) {
        let at = y;
        for (const row of rows) {
          doc.font(REGULAR).fontSize(m.body).fillColor(COLOR.ink).text('•', left + 3 * scale, at, { lineBreak: false });
          at = row.draw(at) + gap;
        }
        return at - gap;
      },
    };
  };

  /** One entry of a section: its blocks stacked closely, and kept together on a page. */
  const entry = (...blocks: (Block | null)[]): Block => stack(blocks.filter((x): x is Block => x !== null), 2 * scale);

  /** A title on the left with its dates on the right, on the same line. */
  const entryHead = (title: Seg[], dates: string): Block => {
    const when = scrub(dates);
    doc.font(REGULAR).fontSize(m.small);
    const dateW = when ? Math.ceil(doc.widthOfString(when)) + 2 : 0;
    const head = text(title.map((p) => ({ ...p, bold: true })), { font: BOLD, size: m.title, color: COLOR.ink }, left, width - (dateW ? dateW + 12 : 0));
    const date = dateW ? text(when, { ...small, align: 'right' }, left + width - dateW, dateW) : null;
    const height = Math.max(head.height, date?.height ?? 0);
    return {
      height,
      draw(y) {
        date?.draw(y + ASCENT * (m.title - m.small)); // line the two baselines up
        head.draw(y);
        return y + height;
      },
    };
  };

  /**
   * "Position, Company" with the company linked when it has a url. The comma and space stay with the first piece: where
   * pdfkit joins two pieces of text it can leave a hairline gap, and inside a space nobody can see it.
   */
  const title = (first: unknown, second: unknown, url?: unknown): Seg[] => {
    const a = str(first);
    const c = str(second);
    return [{ text: a && c ? `${a}, ` : a }, { text: c, link: safeUrl(str(url)) }];
  };

  const heading = (label: string): Block => {
    const t = text(label.toUpperCase(), { font: BOLD, size: m.h2, color: COLOR.accent, spacing: 0.9 }, left, width);
    return {
      height: t.height + 3 + 6 * scale,
      draw(y) {
        t.draw(y);
        const at = y + t.height + 3;
        doc.moveTo(left, at).lineTo(left + width, at).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
        return at + 6 * scale;
      },
    };
  };

  const section = (label: string, entries: (Block | null)[], gap = m.entryGap): Unit[] => {
    const shown = entries.filter((x): x is Block => x !== null);
    if (!shown.length) return [];
    return [
      { before: m.sectionGap, blocks: [heading(label), shown[0]!] },
      ...shown.slice(1).map((x): Unit => ({ before: gap, blocks: [x] })),
    ];
  };

  // ---- rows of linked details: the header's contact line, and the running header on later pages ----

  const drawIcon = (name: PdfIcon, x: number, y: number, size: number) => {
    const icon = ICONS[name];
    doc.save();
    doc.translate(x, y).scale(size / 24);
    if ('fill' in icon) {
      for (const d of icon.fill) doc.path(d).fill(COLOR.muted);
    } else {
      doc.lineWidth(2).lineCap('round').lineJoin('round').strokeColor(COLOR.muted);
      for (const d of icon.stroke) doc.path(d).stroke();
    }
    doc.restore();
  };

  /** Items side by side, wrapping onto further rows; each item is its icon (if any) and its text, linked as one. */
  const itemsRow = (items: RowItem[], x0: number, rowWidth: number): Block => {
    const size = m.small;
    const iconSize = size * 1.1;
    const iconSpace = iconSize + size * 0.45;
    const gap = 14 * scale;
    const pitch = size * NATURAL_LINE + 3 * scale;
    const placed: { item: RowItem; text: string; dx: number; row: number; w: number }[] = [];
    let dx = 0;
    let row = 0;
    for (const item of items) {
      const t = scrub(item.text).trim();
      if (!t) continue;
      doc.font(item.bold ? BOLD : REGULAR).fontSize(size);
      const w = (item.icon ? iconSpace : 0) + doc.widthOfString(t);
      if (dx > 0 && dx + w > rowWidth) { row += 1; dx = 0; }
      placed.push({ item, text: t, dx, row, w });
      dx += w + gap;
    }
    const height = placed.length ? (row + 1) * pitch - 3 * scale : 0;
    return {
      height,
      draw(y) {
        for (const { item, text: t, dx: at, row: r, w } of placed) {
          const x = x0 + at;
          const rowTop = y + r * pitch;
          // Centre the icon on the capital letters: Helvetica's cap height is about its ascender, so on half of it.
          if (item.icon) drawIcon(item.icon, x, rowTop + ASCENT * size / 2 - iconSize / 2, iconSize);
          doc.font(item.bold ? BOLD : REGULAR).fontSize(size).fillColor(item.bold ? COLOR.ink : COLOR.muted)
            .text(t, x + (item.icon ? iconSpace : 0), rowTop, { lineBreak: false });
          if (item.link) doc.link(x, rowTop, w, size * NATURAL_LINE, item.link);
        }
        return y + height;
      },
    };
  };

  // ---- running header: every page after the first starts with the name and the addresses written out ----
  // A link can't be clicked on paper, so here the address itself is the text (no icons, no handles). Page 1 keeps the web
  // header. The header is drawn last, once the pages exist; here we only measure it, to know how far down later pages start.

  const runningRow = (): Block | null => {
    const items: RowItem[] = [];
    if (name) items.push({ text: name, bold: true });
    if (str(b.email).trim()) items.push({ text: str(b.email).trim(), link: `mailto:${str(b.email).trim()}` });
    const site = safeUrl(str(b.url));
    if (site) items.push({ text: displayUrl(site), link: site });
    for (const p of records(b.profiles)) {
      if (!str(p.network) && !str(p.username)) continue;
      const href = safeUrl(str(p.url));
      const shown = href ? displayUrl(href) : [str(p.network), str(p.username)].filter(Boolean).join(': ');
      if (shown) items.push({ text: shown, link: href });
    }
    const row = itemsRow(items, left, width);
    return row.height > 0 ? row : null;
  };
  const running = runningRow();
  const runningRuleGap = 5 * scale;
  const runningGap = 12 * scale;
  /** Where the content starts on pages 2 and later: below the running header. */
  const continueTop = top + (running ? running.height + runningRuleGap + 0.6 + runningGap : 0);
  const drawRunningHeader = () => {
    if (!running) return;
    const rule = running.draw(top) + runningRuleGap;
    doc.moveTo(left, rule).lineTo(left + width, rule).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
  };

  doc.on('pageAdded', () => {
    pages += 1;
    // Every page after the first starts below the running header, including a page pdfkit starts by itself when one very
    // long paragraph runs on (it would otherwise restart at the top margin, underneath the header).
    doc.page.margins.top = continueTop;
    doc.y = continueTop;
  });

  // ---- header ----

  const image = photoBytes(opts.photo);
  const header = (): Block => {
    const photoD = image ? m.photo : 0;
    const textX = left + (photoD ? photoD + 16 : 0);
    const textW = width - (photoD ? photoD + 16 : 0);

    // Same entries, order and icons as the web header: known networks show an icon and the handle, others "Network: handle".
    const items: RowItem[] = [];
    const add = (item: RowItem) => { if (item.text.trim()) items.push(item); };
    add({ icon: 'map-pin', text: locationLine(b.location) });
    add({ icon: 'email', text: str(b.email), link: str(b.email).trim() ? `mailto:${str(b.email).trim()}` : undefined });
    add({ text: str(b.phone) });
    const site = safeUrl(str(b.url));
    if (site) add({ icon: 'web', text: displayUrl(site), link: site });
    for (const p of records(b.profiles)) {
      if (!str(p.network) && !str(p.username)) continue;
      const href = safeUrl(str(p.url));
      const icon = profileIcon({ network: str(p.network), url: str(p.url) });
      if (icon) add({ icon, text: str(p.username) || (href ? displayUrl(href) : ''), link: href });
      else add({ text: [str(p.network), str(p.username)].filter(Boolean).join(': '), link: href });
    }

    const contact = itemsRow(items, textX, textW);

    const column = stack([
      text(name, { font: BOLD, size: m.h1, color: COLOR.ink, line: 1.15 }, textX, textW),
      spacer(label ? 2 * scale : 0),
      text(label, { size: m.label, color: COLOR.muted }, textX, textW),
      spacer(contact.height ? 7 * scale : 0),
      contact,
    ]);
    const content = Math.max(photoD, column.height);
    const padBottom = 10 * scale;
    return {
      height: content + padBottom + 2,
      draw(y) {
        if (image) {
          const r = photoD / 2;
          const cx = left + r;
          const cy = y + content / 2;
          doc.save();
          try {
            doc.circle(cx, cy, r).clip();
            doc.image(image, cx - r, cy - r, { cover: [photoD, photoD], align: 'center', valign: 'center' });
          } catch {
            // An unreadable photo just leaves its place empty.
          } finally {
            doc.restore(); // always undo the circular clip, or everything drawn after it would be cut off
          }
          doc.circle(cx, cy, r).lineWidth(0.75).strokeColor(COLOR.rule).stroke();
        }
        column.draw(y + (content - column.height) / 2);
        const rule = y + content + padBottom;
        doc.moveTo(left, rule + 1).lineTo(left + width, rule + 1).lineWidth(2).strokeColor(COLOR.ink).stroke();
        return rule + 2;
      },
    };
  };

  // ---- sections (same order, headings and fields as Resume.astro) ----

  const joined = (items: unknown[], sep = ' · '): string => items.map(str).filter(Boolean).join(sep);
  /** dateRange for loosely typed data: anything that isn't text or a number counts as missing. */
  const when = (start: unknown, end: unknown): string => dateRange(str(start), str(end));

  const sections: Record<SectionKey, () => Unit[]> = {
    summary: () => section('Summary', [para(b.summary)]),

    work: () => section('Experience', records(resume.work).map((w) => entry(
      entryHead(title(w.position, w.name, w.url), when(w.startDate, w.endDate)),
      meta(w.location),
      para(w.summary ?? w.description),
      bullets(strings(w.highlights)),
    ))),

    projects: () => section('Projects', records(resume.projects).map((p) => entry(
      entryHead([{ text: str(p.name), link: safeUrl(str(p.url)) }], when(p.startDate, p.endDate)),
      para(p.description),
      bullets(strings(p.highlights)),
      meta(joined(strings(p.keywords))),
    ))),

    education: () => section('Education', records(resume.education).map((e) => entry(
      entryHead(
        [{ text: [joined([e.studyType, e.area], ', '), str(e.institution)].filter(Boolean).join(', ') }],
        when(e.startDate, e.endDate),
      ),
      str(e.score) ? meta(`Score: ${str(e.score)}`) : null,
      meta(joined(strings(e.courses))),
    ))),

    skills: () => {
      const skills = records(resume.skills);
      doc.font(BOLD).fontSize(m.body);
      const termW = Math.min(Math.max(0, ...skills.map((s) => doc.widthOfString(scrub(str(s.name))))) + 14 * scale, width * 0.34);
      const rows = skills.map((s): Block => {
        const dt = text(str(s.name), { ...body, font: BOLD }, left, termW - 8);
        const dd = text(joined(strings(s.keywords), ', '), body, left + termW, width - termW);
        const height = Math.max(dt.height, dd.height);
        return { height, draw: (y) => { dt.draw(y); dd.draw(y); return y + height; } };
      });
      // One block, so the table moves to the next page whole, with its heading, instead of leaving a stray row behind.
      return section('Skills', rows.length ? [stack(rows, 3 * scale)] : []);
    },

    volunteer: () => section('Volunteering', records(resume.volunteer).map((v) => entry(
      entryHead(title(v.position, v.organization, v.url), when(v.startDate, v.endDate)),
      para(v.summary),
      bullets(strings(v.highlights)),
    ))),

    certificates: () => section('Certificates', records(resume.certificates).map((c) => entry(
      text([
        { text: str(c.name), link: safeUrl(str(c.url)) },
        ...(str(c.issuer) ? [{ text: ` — ${str(c.issuer)}` }] : []),
        ...(c.date ? [{ text: `  ${formatDate(str(c.date))}`, color: COLOR.muted }] : []),
      ], body, left, width),
    )), 3 * scale),

    awards: () => section('Awards', records(resume.awards).map((a) => entry(
      text([
        { text: str(a.title), bold: true },
        ...(str(a.awarder) ? [{ text: ` — ${str(a.awarder)}` }] : []),
        ...(a.date ? [{ text: `  ${formatDate(str(a.date))}`, color: COLOR.muted }] : []),
      ], body, left, width),
      para(a.summary),
    )), 5 * scale),

    publications: () => section('Publications', records(resume.publications).map((p) => entry(
      text([
        { text: str(p.name), link: safeUrl(str(p.url)) },
        ...(str(p.publisher) ? [{ text: ` — ${str(p.publisher)}` }] : []),
        ...(p.releaseDate ? [{ text: `  ${formatDate(str(p.releaseDate))}`, color: COLOR.muted }] : []),
      ], body, left, width),
      para(p.summary),
    )), 5 * scale),

    languages: () => section('Languages', [para(
      records(resume.languages).map((l) => [str(l.language), str(l.fluency) && `(${str(l.fluency)})`].filter(Boolean).join(' ')).filter(Boolean).join(' · '),
    )]),

    interests: () => section('Interests', [para(joined(records(resume.interests).map((i) => i.name)))]),

    references: () => section('References', records(resume.references).map((r) => {
      const inner = entry(para(r.reference, body, left + 10, width - 10), para(r.name, small, left + 10, width - 10));
      return {
        height: inner.height,
        draw(y) {
          const end = inner.draw(y);
          doc.moveTo(left + 1, y).lineTo(left + 1, end - 2).lineWidth(2).strokeColor(COLOR.rule).stroke();
          return end;
        },
      };
    })),
  };

  // ---- flow: place units top to bottom, starting a new page rather than splitting an entry ----

  const units: Unit[] = [{ before: 0, blocks: [header()] }, ...order.flatMap((key) => sections[key]())];
  // Room for a unit on a page after the first (the smaller of the two), to tell whether it can be kept whole.
  const contentHeight = bottom - continueTop;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages }));
    doc.on('error', reject);
    try {
      let y = top;
      let pageStart = top;
      for (const unit of units) {
        const total = unit.blocks.reduce((sum, x) => sum + x.height, 0);
        // A unit taller than a page can't be kept whole, but its heading still stays with the start of what follows.
        const need = total <= contentHeight ? total : unit.blocks.slice(0, 2).reduce((sum, x) => sum + x.height, 0);
        const atTop = y <= pageStart + 0.5;
        if (!atTop && y + unit.before + need > bottom) {
          doc.addPage();
          y = pageStart = continueTop;
        } else if (!atTop) {
          y += unit.before;
        }
        for (const block of unit.blocks) y = block.draw(y);
      }

      // Drawn last, on each finished page: the running header on pages 2 and later, and "Page x of y" centred in the bottom
      // margin when there is more than one page to count. Both sit in the margins, outside the content area, so they
      // can't move anything or change how many pages there are.
      const { start, count } = doc.bufferedPageRange();
      for (let i = 0; i < count; i++) {
        const page = doc.switchToPage(start + i);
        if (i > 0) drawRunningHeader();
        if (count > 1) {
          const size = m.small * 0.9;
          const bottomMargin = page.margins.bottom;
          page.margins.bottom = 0; // text below the old bottom margin would otherwise make pdfkit start a new page
          doc.font(REGULAR).fontSize(size).fillColor(COLOR.muted)
            .text(`Page ${i + 1} of ${count}`, left, bottom + m.marginY * 0.32, { width, align: 'center', lineBreak: false });
          page.margins.bottom = bottomMargin;
        }
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Type and spacing multipliers tried in turn until the one-page CV fits on a single sheet (about 8 pt body text at the floor). */
const FIT_SCALES = [1, 0.96, 0.92, 0.88, 0.85];

/**
 * Renders a resume as an A4 PDF. The one-page variant is shrunk step by step until it fits on one page; if it still
 * doesn't at the smallest size it runs onto a second page rather than turning unreadable.
 */
export async function renderResumePdf(resume: Resume, opts: PdfOptions = {}): Promise<Buffer> {
  if (opts.variant !== 'one-page') return (await renderOnce(resume, opts, 1)).buffer;
  let last = await renderOnce(resume, opts, FIT_SCALES[0]!);
  for (const scale of FIT_SCALES.slice(1)) {
    if (last.pages === 1) break;
    last = await renderOnce(resume, opts, scale);
  }
  return last.buffer;
}
