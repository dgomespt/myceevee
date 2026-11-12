import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cv_settings (
      cv_key TEXT PRIMARY KEY,
      public INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS links (
      token_hash TEXT PRIMARY KEY,
      cv_key TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    -- Running view counts. link_hash is '' for a public CV; label is copied from the link so it outlives pruning of the link.
    CREATE TABLE IF NOT EXISTS view_totals (
      cv_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      link_hash TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      views INTEGER NOT NULL DEFAULT 0,
      last_viewed_at INTEGER NOT NULL,
      PRIMARY KEY (cv_key, kind, link_hash)
    );
    -- One row per distinct visitor per public CV per UTC day. The visitor is a salted hash that changes every day;
    -- no IP address or user agent is ever stored.
    CREATE TABLE IF NOT EXISTS visitors_daily (
      day TEXT NOT NULL,
      cv_key TEXT NOT NULL,
      visitor TEXT NOT NULL,
      PRIMARY KEY (day, cv_key, visitor)
    ) WITHOUT ROWID;
  `);
  return db;
}

let shared: Db | null = null;
export function getDb(): Db {
  return (shared ??= openDb(config.databasePath));
}
