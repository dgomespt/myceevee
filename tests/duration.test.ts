import { describe, expect, it } from 'vitest';
import { MAX_TTL_SECONDS, parseTtlSeconds, remaining } from '../src/lib/duration';

describe('parseTtlSeconds', () => {
  it('uses the preset when no custom value is given', () => {
    expect(parseTtlSeconds('24', '')).toBe(86400);
  });
  it('lets custom hours override the preset, including fractions', () => {
    expect(parseTtlSeconds('24', '0.5')).toBe(1800);
  });
  it('rejects zero, negatives, junk and values over a year', () => {
    expect(parseTtlSeconds('0', '')).toBeNull();
    expect(parseTtlSeconds('24', '-1')).toBeNull();
    expect(parseTtlSeconds('abc', '')).toBeNull();
    expect(parseTtlSeconds('24', String((MAX_TTL_SECONDS / 3600) + 1))).toBeNull();
  });
});

describe('remaining', () => {
  const now = 0;
  it('formats days, hours and minutes', () => {
    expect(remaining((6 * 24 + 3) * 3600_000, now)).toBe('in 6d 3h');
    expect(remaining(2 * 24 * 3600_000, now)).toBe('in 2d');
    expect(remaining(90 * 60_000, now)).toBe('in 1h 30m');
    expect(remaining(45 * 60_000, now)).toBe('in 45m');
    expect(remaining(30_000, now)).toBe('in <1m');
  });
});

import { formatDuration, parseDuration } from '../src/lib/duration';

describe('parseDuration', () => {
  it('reads units, fractions and bare seconds', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('6h')).toBe(21_600_000);
    expect(parseDuration('2d')).toBe(172_800_000);
    expect(parseDuration('1.5h')).toBe(5_400_000);
    expect(parseDuration(' 45 ')).toBe(45_000);
    expect(parseDuration('6H')).toBe(21_600_000);
  });
  it('rejects junk, zero, negatives and out-of-range values', () => {
    for (const bad of ['', undefined, 'abc', '10x', '-5m', '0', '0s', '31d', '1w', '1h 30m']) {
      expect(parseDuration(bad as string | undefined)).toBeNull();
    }
  });
});

describe('formatDuration', () => {
  it('writes readable durations', () => {
    expect(formatDuration(300_000)).toBe('5 minutes');
    expect(formatDuration(3_600_000)).toBe('1 hour');
    expect(formatDuration(86_400_000)).toBe('1 day');
    expect(formatDuration(5_400_000)).toBe('1 hour 30 minutes');
    expect(formatDuration(30_000)).toBe('30 seconds');
  });
});
