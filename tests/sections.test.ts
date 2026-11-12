import { describe, expect, it } from 'vitest';
import { ALL_SECTIONS, applySections, mostRecent, parseSections } from '../src/lib/sections';
import type { Resume } from '../src/lib/resume';

describe('parseSections', () => {
  it('parses names, limits and keeps the listed order', () => {
    const { specs, warnings } = parseSections('summary, work:3 , education, skills');
    expect(specs).toEqual([{ key: 'summary' }, { key: 'work', limit: 3 }, { key: 'education' }, { key: 'skills' }]);
    expect(warnings).toEqual([]);
  });
  it('accepts aliases and is case-insensitive', () => {
    expect(parseSections('Experience:2, Certifications').specs).toEqual([{ key: 'work', limit: 2 }, { key: 'certificates' }]);
  });
  it('warns about unknown names, bad limits, duplicates and summary limits, but keeps the rest', () => {
    const { specs, warnings } = parseSections('work:0, bogus, projects:x, work:2, summary:3, a:b:c');
    expect(specs).toEqual([{ key: 'work' }, { key: 'projects' }, { key: 'summary' }]);
    expect(warnings.join('|')).toMatch(/Limit "0".*work/);
    expect(warnings.join('|')).toMatch(/Unknown section "bogus"/);
    expect(warnings.join('|')).toMatch(/Unknown option "x" for "projects"/);
    expect(warnings.join('|')).toMatch(/more than once/);
    expect(warnings.join('|')).toMatch(/summary.*does not take a limit/);
    expect(warnings.join('|')).toMatch(/Unknown section "a:b:c"/);
  });
  it('shows all sections (with a warning) when nothing valid is listed, so a typo never blanks the CV', () => {
    const { specs, warnings } = parseSections('nonsense');
    expect(specs.map((s) => s.key)).toEqual([...ALL_SECTIONS]);
    expect(warnings.some((w) => /all sections are shown/.test(w))).toBe(true);
    expect(parseSections('').warnings).toEqual([]); // empty input is not a mistake
  });
});

describe('parseSections: the summary option', () => {
  it('combines with a limit in either order, and works alone', () => {
    expect(parseSections('work:3:summary').specs).toEqual([{ key: 'work', limit: 3, summaryOnly: true }]);
    expect(parseSections('experience:summary:3').specs).toEqual([{ key: 'work', limit: 3, summaryOnly: true }]);
    expect(parseSections('Experience: SUMMARY').specs).toEqual([{ key: 'work', summaryOnly: true }]);
    expect(parseSections('volunteer:summary, projects:2:summary').specs).toEqual([
      { key: 'volunteer', summaryOnly: true },
      { key: 'projects', limit: 2, summaryOnly: true },
    ]);
  });
  it('warns, and ignores the option, on sections it does not apply to', () => {
    const { specs, warnings } = parseSections('skills:summary, education:2:summary, summary:summary');
    expect(specs).toEqual([{ key: 'skills' }, { key: 'education', limit: 2 }, { key: 'summary' }]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/"summary" only applies to work, volunteer, projects, not "skills"/);
  });
  it('warns about unknown options and repeated limits but keeps the entry', () => {
    const { specs, warnings } = parseSections('work:3:short:5');
    expect(specs).toEqual([{ key: 'work', limit: 3 }]);
    expect(warnings.join('|')).toMatch(/Unknown option "short"/);
    expect(warnings.join('|')).toMatch(/more than one limit; keeping 3/);
  });
});

describe('mostRecent', () => {
  const job = (name: string, startDate?: string, endDate?: string) => ({ name, startDate, endDate });
  const dates = (j: ReturnType<typeof job>) => ({ start: j.startDate, end: j.endDate });
  it('keeps the N most recent whatever the file order, preserving file order in the result', () => {
    const jobs = [job('old', '2005', '2008'), job('newest', '2021-03'), job('mid', '2012', '2016'), job('prev', '2016', '2021-02')];
    expect(mostRecent(jobs, 2, dates).map((j) => j.name)).toEqual(['newest', 'prev']);
    expect(mostRecent([...jobs].reverse(), 2, dates).map((j) => j.name)).toEqual(['prev', 'newest']);
  });
  it('treats a missing end date as ongoing, and ties break on start date', () => {
    const jobs = [job('ended-late', '2000', '2030'), job('ongoing', '2019'), job('a', '2010', '2015'), job('b', '2012', '2015')];
    expect(mostRecent(jobs, 2, dates).map((j) => j.name)).toEqual(['ended-late', 'ongoing']);
    expect(mostRecent(jobs, 3, dates).map((j) => j.name)).toEqual(['ended-late', 'ongoing', 'b']);
  });
  it('ranks undated items last (file order among them) and compares mixed date precisions', () => {
    // 'm' ends 2020-06, 'y' ends 2020 (= start of 2020), so m is more recent than y.
    const jobs = [job('undated1'), job('y', '2020', '2020'), job('undated2'), job('m', '2019', '2020-06')];
    expect(mostRecent(jobs, 2, dates).map((j) => j.name)).toEqual(['y', 'm']);
    expect(mostRecent(jobs, 3, dates).map((j) => j.name)).toEqual(['undated1', 'y', 'm']);
  });
  it('takes the first N when there are no dates, and everything when N is large', () => {
    expect(mostRecent(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(mostRecent(['a', 'b'], 5)).toEqual(['a', 'b']);
  });
});

describe('applySections', () => {
  const resume: Resume = {
    basics: { name: 'Ada', summary: 'Hi' },
    work: [{ name: 'A', startDate: '2010', endDate: '2012' }, { name: 'B', startDate: '2020' }],
    projects: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }],
    skills: [{ name: 'S' }],
    education: [{ institution: 'U' }],
  };
  it('keeps only listed sections, trims limits and never mutates the input', () => {
    const out = applySections(resume, parseSections('work:1, projects:2, skills').specs);
    expect(out.work!.map((w) => w.name)).toEqual(['B']);
    expect(out.projects!.map((p) => p.name)).toEqual(['P1', 'P2']);
    expect(out.skills).toHaveLength(1);
    expect(out.education).toBeUndefined();
    expect(out.basics?.summary).toBeUndefined();
    expect(out.basics?.name).toBe('Ada');
    expect(resume.work).toHaveLength(2);
    expect(resume.basics?.summary).toBe('Hi');
  });
  it('with the summary option, drops highlights but keeps summaries and everything else', () => {
    const r: Resume = {
      work: [
        { name: 'A', position: 'Dev', startDate: '2020', summary: 'Built things.', highlights: ['x', 'y'] },
        { name: 'B', position: 'Ops', startDate: '2010', endDate: '2015', description: 'Kept things running.', highlights: ['z'] },
        { name: 'C', startDate: '2001', endDate: '2003', highlights: ['old'] },
      ],
      projects: [{ name: 'P', description: 'Tool', highlights: ['h'], keywords: ['k'] }],
    };
    const out = applySections(r, parseSections('work:2:summary, projects:summary').specs);
    expect(out.work).toEqual([
      { name: 'A', position: 'Dev', startDate: '2020', summary: 'Built things.', highlights: undefined },
      { name: 'B', position: 'Ops', startDate: '2010', endDate: '2015', description: 'Kept things running.', highlights: undefined },
    ]);
    expect(out.projects).toEqual([{ name: 'P', description: 'Tool', highlights: undefined, keywords: ['k'] }]);
    expect(r.work![0]!.highlights).toEqual(['x', 'y']); // input untouched
  });
  it('keeps the summary when listed', () => {
    expect(applySections(resume, parseSections('summary').specs).basics?.summary).toBe('Hi');
  });
});
