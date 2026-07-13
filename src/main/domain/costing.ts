import { eq, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client.js';
import { components, productVariants, recipes, settings } from '../db/schema.js';
import { bankersRoundToPence } from './money.js';

export interface MovingAverageResult {
  newQuantity: number;
  newAverage: number;
}

// Moving weighted average per spec:
//   new_avg = (old_qty * old_avg + total_cost_pence) / (old_qty + purchased_qty)
// Cost stays in fractional pence (real) until it's collapsed for a snapshot.
export function updateMovingAverage(
  oldQuantity: number | null,
  oldAverage: number | null,
  purchasedQuantity: number,
  totalCostPence: number
): MovingAverageResult {
  if (!(purchasedQuantity > 0)) {
    throw new Error('purchasedQuantity must be > 0 to update moving average');
  }
  const safeOldQty = oldQuantity ?? 0;
  const safeOldAvg = safeOldQty <= 0 ? 0 : (oldAverage ?? 0);
  const newQuantity = safeOldQty + purchasedQuantity;
  const newAverage = (safeOldQty * safeOldAvg + totalCostPence) / newQuantity;
  return { newQuantity, newAverage };
}

// Sum of (qty_per_unit * cost) + cost_pool fixed pence per recipe row, plus
// the labour contribution (labour_hours_per_unit * labour_hourly_rate_pence).
// Returns the fractional pence figure; round at the call site for storage.
export function computeVariantUnitCostFractional(db: DbLike, variantId: number): number {
  const rows = db
    .select({
      quantityPerUnit: recipes.quantity_per_unit,
      costPoolPencePerUnit: recipes.cost_pool_pence_per_unit,
      unit: components.unit,
      componentCost: components.cost_per_unit_pence,
    })
    .from(recipes)
    .innerJoin(components, eq(components.id, recipes.component_id))
    .where(eq(recipes.variant_id, variantId))
    .all();

  let total = 0;
  for (const row of rows) {
    if (row.unit === 'cost_pool') {
      total += row.costPoolPencePerUnit ?? 0;
    } else {
      const qty = row.quantityPerUnit ?? 0;
      const cost = row.componentCost ?? 0;
      total += qty * cost;
    }
  }

  // Labour contribution. Reads labour_hours from the variant and the rate
  // from the singleton settings row.
  const variant = db
    .select({ labourHours: productVariants.labour_hours_per_unit })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .get();
  const rate = db
    .select({ rate: settings.labour_hourly_rate_pence })
    .from(settings)
    .where(eq(settings.id, 1))
    .get();
  const hours = variant?.labourHours ?? 0;
  const ratePence = rate?.rate ?? 0;
  total += hours * ratePence;

  return total;
}

// Recompute the cached unit_cost_pence on a single variant and write it back.
// Returns the integer pence figure that was stored.
export function recomputeVariantCost(db: DbLike, variantId: number): number {
  const fractional = computeVariantUnitCostFractional(db, variantId);
  const rounded = bankersRoundToPence(fractional);
  db.update(productVariants)
    .set({ unit_cost_pence: rounded })
    .where(eq(productVariants.id, variantId))
    .run();
  return rounded;
}

// Recompute every variant whose recipe references the given component.
// Called after a measured component's avg cost changes or any cost_pool tweak.
export function recomputeVariantCostsForComponent(db: DbLike, componentId: number): void {
  const variantIds = db
    .selectDistinct({ id: recipes.variant_id })
    .from(recipes)
    .where(eq(recipes.component_id, componentId))
    .all()
    .map((r) => r.id);

  for (const id of variantIds) {
    recomputeVariantCost(db, id);
  }
}

// Recompute every non-archived variant. Used when something global changes —
// currently only the labour hourly rate.
export function recomputeAllVariantCosts(db: DbLike): void {
  const variantIds = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(isNull(productVariants.archived_at))
    .all()
    .map((v) => v.id);
  for (const id of variantIds) {
    recomputeVariantCost(db, id);
  }
}
