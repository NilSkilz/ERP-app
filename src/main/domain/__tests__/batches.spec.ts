import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/__tests__/test-db.js';
import {
  batches,
  components,
  productVariants,
  products,
  recipes,
  stockMovements,
} from '../../db/schema.js';
import { makeBatch, previewBatch } from '../batches.js';
import { purchaseComponent } from '../components.js';

function seed() {
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

describe('previewBatch', () => {
  it('computes per-row consumption and reports warnings empty when stock is fine', () => {
    const { db, variant } = seed();
    const p = previewBatch(db, { variantId: variant.id, quantity: 2 });
    expect(p.quantity).toBe(2);
    // unit cost = 250 + 20 + 8 = 278
    expect(p.unitCostPence).toBe(278);
    expect(p.totalCostPence).toBe(556);
    expect(p.warnings).toHaveLength(0);
    // 3 rows
    expect(p.rows).toHaveLength(3);
  });

  it('flags the components that would go negative', () => {
    const { db, variant } = seed();
    // Asking for 30 wallets needs 24,000 mm of thread but we only have 10,000.
    const p = previewBatch(db, { variantId: variant.id, quantity: 30 });
    expect(p.warnings.length).toBeGreaterThan(0);
    const names = p.warnings.map((w) => w.componentName);
    expect(names).toContain('Thread');
  });
});

describe('makeBatch (transactional)', () => {
  it('happy path: writes movements, decrements stock, increments variant, assigns batch number', () => {
    const { db, variant, rivets, thread, leather } = seed();
    const res = makeBatch(db, { variantId: variant.id, quantity: 2 });

    expect(res.batchNumber).toBe(1);
    expect(res.unitCostPenceAtProduction).toBe(278);
    expect(res.warnings).toHaveLength(0);

    // 3 stock movements with reason='production'
    const moves = db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.batch_id, res.batchId))
      .all();
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.reason === 'production')).toBe(true);

    // Components decremented
    const r = db.select().from(components).where(eq(components.id, rivets.id)).get();
    const t = db.select().from(components).where(eq(components.id, thread.id)).get();
    const l = db.select().from(components).where(eq(components.id, leather.id)).get();
    expect(r?.stock_quantity).toBe(100 - 8);     // 4 * 2
    expect(t?.stock_quantity).toBe(10000 - 1600); // 800 * 2
    expect(l?.stock_value_pence).toBe(5000 - 500); // 250 * 2

    // Variant finished-goods +2
    const v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    expect(v?.stock_quantity).toBe(2);
  });

  it('per-variant batch numbers increment', () => {
    const { db, variant } = seed();
    const a = makeBatch(db, { variantId: variant.id, quantity: 1 });
    const b = makeBatch(db, { variantId: variant.id, quantity: 1 });
    const c = makeBatch(db, { variantId: variant.id, quantity: 1 });
    expect([a.batchNumber, b.batchNumber, c.batchNumber]).toEqual([1, 2, 3]);
  });

  it('allows negative stock and returns warnings rather than throwing', () => {
    const { db, variant, thread } = seed();
    // Need 24,000 mm of thread; only 10,000 in stock.
    const res = makeBatch(db, { variantId: variant.id, quantity: 30 });
    expect(res.warnings.length).toBeGreaterThan(0);
    const w = res.warnings.find((x) => x.componentName === 'Thread');
    expect(w).toBeTruthy();

    // Thread stock should now be negative.
    const t = db.select().from(components).where(eq(components.id, thread.id)).get();
    expect(t?.stock_quantity).toBeLessThan(0);

    // The batch still exists.
    const all = db.select().from(batches).all();
    expect(all).toHaveLength(1);
  });

  it('rolls back when the recipe is empty (no rows written)', () => {
    const { db, variant } = seed();
    db.delete(recipes).run();
    expect(() => makeBatch(db, { variantId: variant.id, quantity: 1 })).toThrow();
    expect(db.select().from(batches).all()).toHaveLength(0);
    expect(db.select().from(stockMovements).all()).toHaveLength(0);
    // Finished-goods stock unchanged.
    const v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    expect(v?.stock_quantity).toBe(0);
  });

  it('updates the variant cached unit_cost_pence after running', () => {
    const { db, variant } = seed();
    // Pre-condition: unit_cost_pence is null.
    let v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    expect(v?.unit_cost_pence).toBeNull();

    makeBatch(db, { variantId: variant.id, quantity: 1 });

    v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    expect(v?.unit_cost_pence).toBe(278);
  });

  it('moving avg + recomputeVariantCostsForComponent: purchase refreshes downstream variant cost', () => {
    const { db, variant, rivets } = seed();
    // Cause a measurable change: bump rivet cost from 5p to 10p via a fresh purchase.
    // Current: 100 rivets @ 5p; buy 100 more @ 1500p total = (100*5 + 1500) / 200 = 10p.
    purchaseComponent(db, { componentId: rivets.id, quantity: 100, totalCostPence: 1500 });

    const v = db.select().from(productVariants).where(eq(productVariants.id, variant.id)).get();
    // 250 + (4 * 10) + (800 * 0.01) = 250 + 40 + 8 = 298
    expect(v?.unit_cost_pence).toBe(298);
  });
});
