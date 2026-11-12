import type { Resume } from './resume';

/** Sections in the order the full CV shows them. `summary` is basics.summary; the rest are top-level JSON Resume keys. */
export const ALL_SECTIONS = [
  'summary', 'work', 'projects', 'education', 'skills', 'volunteer',
  'certificates', 'awards', 'publications', 'languages', 'interests', 'references',
] as const;
export type SectionKey = (typeof ALL_SECTIONS)[number];
type ListKey = Exclude<SectionKey, 'summary'>;

const ALIASES: Record<string, SectionKey> = {
  experience: 'work', employment: 'work', jobs: 'work',
  volunteering: 'volunteer',
  certifications: 'certificates', certificate: 'certificates', certification: 'certificates',
  project: 'projects', skill: 'skills', language: 'languages', interest: 'interests',
  award: 'awards', publication: 'publications', reference: 'references',
};
const KNOWN = new Set<string>(ALL_SECTIONS);

export interface SectionSpec {
  key: SectionKey;
  /** Show only the N most recent entries. */
  limit?: number;
  /** Show each entry's summary text only, without its bullet highlights (work, volunteer, projects). */
  summaryOnly?: true;
}

/** Sections whose entries have bullet highlights that the `summary` option can drop. */
const SUPPORTS_SUMMARY_ONLY = new Set<SectionKey>(['work', 'volunteer', 'projects']);

/**
 * Parses "summary, experience:3:summary, projects:2, education". Names accept friendly aliases (experience = work).
 * After the name come options separated by colons, in any order: a number (show only the N most recent entries) and/or
 * `summary` (each entry shows its summary text only, no bullet highlights; for work, volunteer and projects).
 * Problems never throw: they come back as warnings and the offending part is ignored.
 * If nothing valid is left, all sections are shown (with a warning) so a typo can't produce a blank CV.
 */
export function parseSections(spec: string): { specs: SectionSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  const specs: SectionSpec[] = [];
  for (const token of spec.split(',').map((t) => t.trim()).filter(Boolean)) {
    const [rawName = '', ...options] = token.split(':').map((p) => p.trim());
    const lower = rawName.toLowerCase();
    const key = KNOWN.has(lower) ? (lower as SectionKey) : ALIASES[lower];
    if (!key) {
      warnings.push(`Unknown section "${token}" (known: ${ALL_SECTIONS.join(', ')})`);
      continue;
    }
    if (specs.some((s) => s.key === key)) {
      warnings.push(`Section "${key}" is listed more than once; keeping the first`);
      continue;
    }
    const entry: SectionSpec = { key };
    for (const option of options.filter(Boolean)) {
      if (/^\d+$/.test(option)) {
        if (key === 'summary') warnings.push('"summary" does not take a limit; ignoring it');
        else if (Number(option) < 1) warnings.push(`Limit "${option}" for "${key}" must be 1 or more; showing all`);
        else if (entry.limit) warnings.push(`"${key}" has more than one limit; keeping ${entry.limit}`);
        else entry.limit = Number(option);
      } else if (option.toLowerCase() === 'summary') {
        if (SUPPORTS_SUMMARY_ONLY.has(key)) entry.summaryOnly = true;
        else warnings.push(`"summary" only applies to ${[...SUPPORTS_SUMMARY_ONLY].join(', ')}, not "${key}"; ignoring it`);
      } else {
        warnings.push(`Unknown option "${option}" for "${key}" (use a number to limit entries, or "summary" for summaries only)`);
      }
    }
    specs.push(entry);
  }
  if (specs.length === 0) {
    if (spec.trim()) warnings.push('No valid sections were listed, so all sections are shown');
    return { specs: ALL_SECTIONS.map((key) => ({ key })), warnings };
  }
  return { specs, warnings };
}

// ---- "most recent N" ---------------------------------------------------------------------------

type Dates = { start?: string; end?: string };
type Item<K extends ListKey> = NonNullable<Resume[K]>[number];
/** How to read the start/end dates of an entry in each dated section, typed against the real JSON Resume shapes. */
const DATES: { [K in ListKey]?: (item: Item<K>) => Dates } = {
  work: (i) => ({ start: i.startDate, end: i.endDate }),
  volunteer: (i) => ({ start: i.startDate, end: i.endDate }),
  education: (i) => ({ start: i.startDate, end: i.endDate }),
  projects: (i) => ({ start: i.startDate, end: i.endDate }),
  awards: (i) => ({ end: i.date }),
  certificates: (i) => ({ end: i.date }),
  publications: (i) => ({ end: i.releaseDate }),
};

/** "2020" | "2020-03" | "2020-03-14" -> sortable "YYYY-MM-DD" (missing parts sort first). Null if unparseable. */
function normalise(d?: string): string | null {
  const m = d ? /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(d.trim()) : null;
  return m ? `${m[1]}-${m[2] ?? '00'}-${m[3] ?? '00'}` : null;
}

/** end (ongoing = newest possible) then start; null when the item has no usable date. */
function recency({ start, end }: Dates): [string, string] | null {
  const s = normalise(start);
  const e = normalise(end);
  if (e) return [e, s ?? ''];
  if (s) return ['9999-99-99', s]; // started, never ended: ongoing
  return null;
}

/** The N most recent items, still in their original file order. Undated items count as oldest. Sections without dates take the first N. */
export function mostRecent<T>(items: T[], n: number, dates?: (item: T) => Dates): T[] {
  if (items.length <= n) return items;
  if (!dates) return items.slice(0, n);
  const ranked = items
    .map((item, index) => ({ index, r: recency(dates(item)) }))
    .sort((a, b) => {
      if (!a.r || !b.r) return a.r ? -1 : b.r ? 1 : a.index - b.index;
      return b.r[0].localeCompare(a.r[0]) || b.r[1].localeCompare(a.r[1]) || a.index - b.index;
    });
  const keep = new Set(ranked.slice(0, n).map((x) => x.index));
  return items.filter((_, i) => keep.has(i));
}

/** Returns a copy of the resume with only the listed sections, each trimmed to its limit and options. */
export function applySections(resume: Resume, specs: SectionSpec[]): Resume {
  const out: Resume = { ...resume };
  const listed = new Map(specs.map((s) => [s.key, s]));
  if (out.basics && !listed.has('summary')) out.basics = { ...out.basics, summary: undefined };
  for (const key of ALL_SECTIONS) {
    if (key === 'summary') continue;
    const spec = listed.get(key);
    const items = resume[key] as unknown[] | undefined;
    if (!spec || !Array.isArray(items)) {
      delete out[key];
    } else {
      const kept = spec.limit ? mostRecent(items, spec.limit, DATES[key] as ((item: unknown) => Dates) | undefined) : items;
      (out as Record<string, unknown>)[key] = spec.summaryOnly
        ? kept.map((item) => ({ ...(item as object), highlights: undefined }))
        : kept;
    }
  }
  return out;
}
