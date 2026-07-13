import { eq } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { settings } from '../db/schema.js';
import { recomputeAllVariantCosts } from './costing.js';

export interface AppSettings {
  labourHourlyRatePence: number;
}

export function getSettings(db: DbLike): AppSettings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  // The seed in migrate.ts guarantees this row exists, but be defensive
  // anyway so an unexpected empty row never crashes the app.
  return {
    labourHourlyRatePence: row?.labour_hourly_rate_pence ?? 0,
  };
}

export function updateSettings(db: Db, patch: Partial<AppSettings>) {
  return db.transaction((tx) => {
    if (patch.labourHourlyRatePence !== undefined) {
      tx.update(settings)
        .set({
          labour_hourly_rate_pence: patch.labourHourlyRatePence,
          updated_at: new Date(),
        })
        .where(eq(settings.id, 1))
        .run();
      // Labour rate affects every variant's cached unit cost; refresh all.
      recomputeAllVariantCosts(tx);
    }
    return getSettings(tx);
  });
}
