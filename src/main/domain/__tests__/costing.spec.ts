import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../db/__tests__/test-db.js';
import { components, productVariants, products, recipes } from '../../db/schema.js';
import {
  computeVariantUnitCostFractional,
  recomputeVariantCost,
  updateMovingAverage,
} from '../costing.js';
import { eq } from 'drizzle-orm';

describe('updateMovingAverage', () => {
  it('first purchase = price-per-unit becomes the average', () => {
    const r = updateMovingAverage(0, null, 10, 1000); // £10 for 10 units = 100p each
    expect(r.newQuantity).toBe(10);
    expect(r.newAverage).toBe(100);
  });

  it('first purchase with null old stock still works', () => {
    const r = updateMovingAverage(null, null, 5, 500);
    expect(r.newQuantity).toBe(5);
    expect(r.newAverage).toBe(100);
  });

  it('weighted average across two purchases', () => {
    // 10 units @ 100p, then 10 more @ 200p => 20 units @ 150p
    const r = updateMovingAverage(10, 100, 10, 2000);
    expect(r.newQuantity).toBe(20);
    expect(r.newAverage).toBe(150);
  });

  it('produces fractional pence when needed', () => {
    // 3 units @ 100p, then 1 unit costing 100p => 4 units @ 100p
    // But: 3 @ 100 + 1 @ 200 => total 500p over 4 = 125p
    // Tweaked: 3 units @ 100p + 1 unit @ 110p => total 410p / 4 = 102.5p
    const r = updateMovingAverage(3, 100, 1, 110);
    expect(r.newQuantity).toBe(4);
    expect(r.newAverage).toBeCloseTo(102.5, 5);
  });

  it('rejects non-positive purchased quantity', () => {
    expect(() => updateMovingAverage(0, null, 0, 100)).toThrow();
    expect(() => updateMovingAverage(0, null, -1, 100)).toThrow();
  });
});

function seedFixtures() {
  const db = createTestDb();
  const rivets = db
    .insert(components)
    .values({
      name: 'Rivets',
      unit: 'each',
      stock_quantity: 100,
      cost_per_unit_pence: 5,
    })
    .returning()
    .get();
  const thread = db
    .insert(components)
    .values({
      name: 'Thread',
      unit: 'mm',
      stock_quantity: 10000,
      cost_per_unit_pence: 0.01,
    })
    .returning()
    .get();
  const leather = db
    .insert(components)
    .values({ name: 'Leather pool', unit: 'cost_pool', stock_value_pence: 5000 })
    .returning()
    .get();
  const product = db.insert(products).values({ name: 'Hex Wallet' }).returning().get();
  const variant = db
    .insert(productVariants)
    .values({
      product_id: product.id,
      sku: 'HW-BLK',
      variant_name: 'Black',
      price_pence: 4000,
    })
    .returning()
    .get();
  db.insert(recipes)
    .values([
      { variant_id: variant.id, component_id: leather.id, cost_pool_pence_per_unit: 250 },
      { variant_id: variant.id, component_id: rivets.id, quantity_per_unit: 4 },
      { variant_id: variant.id, component_id: thread.id, quantity_per_unit: 800 },
    ])
    .run();
  return { db, variant, rivets, thread, leather };
}

describe('computeVariantUnitCostFractional', () => {
  it('sums measured (qty * cost) and cost_pool flat', () => {
    const { db, variant } = seedFixtures();
    // leather pool: 250p
    // rivets: 4 * 5p = 20p
    // thread: 800mm * 0.01p = 8p
    // total: 278p
    expect(computeVariantUnitCostFractional(db, variant.id)).toBeCloseTo(278, 5);
  });

  it('treats null component cost as zero (warns implicitly by being 0)', () => {
    const { db, variant, rivets } = seedFixtures();
    db.update(components)
      .set({ cost_per_unit_pence: null })
      .where(eq(components.id, rivets.id))
      .run();
    // 250 + 0 + 8 = 258
    expect(computeVariantUnitCostFractional(db, variant.id)).toBeCloseTo(258, 5);
  });

  it('produces fractional pence and survives the round trip', () => {
    const { db, variant, thread } = seedFixtures();
    // Thread cost 0.015p/mm * 800 = 12p; total = 250 + 20 + 12 = 282
    db.update(components)
      .set({ cost_per_unit_pence: 0.015 })
      .where(eq(components.id, thread.id))
      .run();
    expect(computeVariantUnitCostFractional(db, variant.id)).toBeCloseTo(282, 5);
  });
});

describe('recomputeVariantCost', () => {
  it('writes the rounded integer to product_variants.unit_cost_pence', () => {
    const { db, variant } = seedFixtures();
    const rounded = recomputeVariantCost(db, variant.id);
    expect(rounded).toBe(278);
    const v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    expect(v?.unit_cost_pence).toBe(278);
  });

  it("uses banker's rounding on .5 halves", () => {
    const { db, variant, thread } = seedFixtures();
    // 250 + 20 + (800 * 0.011875) = 250 + 20 + 9.5 = 279.5 -> 280 (even)
    db.update(components)
      .set({ cost_per_unit_pence: 0.011875 })
      .where(eq(components.id, thread.id))
      .run();
    const rounded = recomputeVariantCost(db, variant.id);
    expect(rounded).toBe(280);
  });
});
