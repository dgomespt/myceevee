export const MAX_TTL_SECONDS = 365 * 24 * 3600;

/** Custom hours (if given) override the preset (hours as a string). Returns seconds, or null when invalid. */
export function parseTtlSeconds(preset: string, customHours: string): number | null {
  const raw = customHours.trim() !== '' ? customHours : preset;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const seconds = Math.round(hours * 3600);
  return seconds <= MAX_TTL_SECONDS ? seconds : null;
}

/** "in 6d 3h", "in 45m", "in <1m" */
export function remaining(untilMs: number, nowMs = Date.now()): string {
  const mins = Math.floor((untilMs - nowMs) / 60_000);
  if (mins < 1) return 'in <1m';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `in ${d}d ${h}h` : `in ${d}d`;
  if (h > 0) return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  return `in ${m}m`;
}

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
export const MIN_CACHE_MS = 1000;
export const MAX_CACHE_MS = 30 * UNIT_MS.d;

/** "30m", "6h", "7d", "90s", "1.5h". A bare number means seconds. Returns ms, or null if invalid or out of range (1s to 30d). */
export function parseDuration(input: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/i.exec((input ?? '').trim());
  if (!m) return null;
  const ms = Math.round(Number(m[1]) * UNIT_MS[(m[2]?.toLowerCase() ?? 's') as keyof typeof UNIT_MS]);
  return ms >= MIN_CACHE_MS && ms <= MAX_CACHE_MS ? ms : null;
}

/** 300000 -> "5 minutes", 86400000 -> "1 day", 5400000 -> "1 hour 30 minutes" */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = Math.round(ms / 1000);
  for (const [label, secs] of [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
    const n = Math.floor(rest / secs);
    rest -= n * secs;
    if (n > 0) parts.push(`${n} ${label}${n === 1 ? '' : 's'}`);
  }
  return parts.slice(0, 2).join(' ') || '0 seconds';
}
