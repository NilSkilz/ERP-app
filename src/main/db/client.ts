import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = BetterSQLite3Database<Schema> & { $client: Database.Database };

// The transaction callback gets a wider DB-like surface; this alias lets
// domain functions accept either the root Db or a transaction handle.
export type DbLike = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown
  ? T | Db
  : never;

export function openDatabase(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  return drizzle(sqlite, { schema }) as Db;
}
