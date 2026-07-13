import type { Db } from '../db/client.js';

export interface Context {
  db: Db;
}

export function createContext(db: Db): Context {
  return { db };
}
