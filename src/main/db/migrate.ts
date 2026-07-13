import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

export function runMigrations(db: Db, migrationsFolder: string): void {
  drizzleMigrate(db, { migrationsFolder });
  // Ensure the single-row settings table has its row. Idempotent.
  db.run(
    sql`INSERT OR IGNORE INTO settings (id, labour_hourly_rate_pence) VALUES (1, 0)`
  );
}
