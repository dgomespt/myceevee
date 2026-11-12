import { describe, expect, it } from 'vitest';
import { openDb } from '../src/lib/db';
import { checkHealth } from '../src/lib/health';

describe('checkHealth', () => {
  it('is ok when the database answers', () => {
    const db = openDb(':memory:');
    expect(checkHealth(() => db)).toEqual({ ok: true, status: 'ok' });
  });

  it('is not ok when the database is closed', () => {
    const db = openDb(':memory:');
    db.close();
    expect(checkHealth(() => db)).toEqual({ ok: false, status: 'error' });
  });

  it('is not ok when the database cannot be opened', () => {
    expect(
      checkHealth(() => {
        throw new Error('cannot open');
      }),
    ).toEqual({ ok: false, status: 'error' });
  });
});
