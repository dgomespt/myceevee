import { describe, expect, it } from 'vitest';
import { dateRange, displayUrl, formatDate, locationLine, profileIcon, safeUrl } from '../src/lib/format';

describe('format', () => {
  it('formats dates at each precision', () => {
    expect(formatDate('2020-03-14')).toBe('Mar 2020');
    expect(formatDate('2020-03')).toBe('Mar 2020');
    expect(formatDate('2020')).toBe('2020');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('sometime')).toBe('sometime');
  });
  it('builds ranges, treating a missing end as Present', () => {
    expect(dateRange('2019-01', '2021-06')).toBe('Jan 2019 – Jun 2021');
    expect(dateRange('2019-01')).toBe('Jan 2019 – Present');
    expect(dateRange(undefined, '2018')).toBe('2018');
    expect(dateRange()).toBe('');
  });
  it('only allows http(s) urls', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,x')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
  });
  it('shortens urls and joins locations', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com');
    expect(locationLine({ city: 'Lisbon', countryCode: 'PT' })).toBe('Lisbon, PT');
  });
});

describe('profileIcon', () => {
  it('matches by network name, case-insensitively', () => {
    expect(profileIcon({ network: 'GitHub' })).toBe('github');
    expect(profileIcon({ network: ' linkedin ' })).toBe('linkedin');
  });
  it('falls back to the url host, but not lookalike hosts', () => {
    expect(profileIcon({ url: 'https://github.com/ada' })).toBe('github');
    expect(profileIcon({ network: 'Work', url: 'https://www.linkedin.com/in/ada' })).toBe('linkedin');
    expect(profileIcon({ url: 'https://notgithub.com/ada' })).toBeNull();
    expect(profileIcon({ url: 'https://github.com.evil.example/x' })).toBeNull();
  });
  it('returns null for other networks', () => {
    expect(profileIcon({ network: 'Mastodon', url: 'https://hachyderm.io/@ada' })).toBeNull();
    expect(profileIcon({})).toBeNull();
  });
});
