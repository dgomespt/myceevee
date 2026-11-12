import { describe, expect, it, vi } from 'vitest';
import { copyText, coversWholeValue } from '../src/scripts/copy';

describe('copyText', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacy = vi.fn(() => true);
    expect(await copyText('https://x/s/abc', { clipboard: { writeText }, legacy })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://x/s/abc');
    expect(legacy).not.toHaveBeenCalled();
  });
  it('falls back to the legacy copy when the Clipboard API is missing or rejects', async () => {
    expect(await copyText('t', { legacy: () => true })).toBe(true);
    const reject = { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };
    expect(await copyText('t', { clipboard: reject, legacy: () => true })).toBe(true);
  });
  it('reports failure when nothing works, including a throwing fallback', async () => {
    expect(await copyText('t', {})).toBe(false);
    expect(await copyText('t', { legacy: () => false })).toBe(false);
    expect(await copyText('t', { legacy: () => { throw new Error('nope'); } })).toBe(false);
  });
});

describe('coversWholeValue', () => {
  it('is true only when the entire value is selected', () => {
    expect(coversWholeValue(0, 20, 20)).toBe(true);
    expect(coversWholeValue(0, 10, 20)).toBe(false);
    expect(coversWholeValue(5, 20, 20)).toBe(false);
    expect(coversWholeValue(3, 3, 20)).toBe(false); // just a caret
    expect(coversWholeValue(null, null, 20)).toBe(false);
    expect(coversWholeValue(0, 0, 0)).toBe(false); // empty field
  });
});
