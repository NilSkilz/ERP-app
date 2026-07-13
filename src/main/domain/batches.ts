import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { batches, components, productVariants, recipes, stockMovements } from '../db/schema.js';
import { recomputeVariantCost } from './costing.js';
import { bankersRoundToPence } from './money.js';

export interface MakeBatchInput {
  variantId: number;
  quantity: number;
  notes?: string | null;
}

export interface RecipeConsumption {
  componentId: number;
  componentName: string;
  unit: string;
  quantityConsumed: number;          // 0 for cost_pool
  valueConsumedPence: number;        // positive integer pence (the cost)
  newStockQuantity: number | null;   // after deduction (measured)
  newStockValuePence: number | null; // after deduction (cost_pool)
  isNegative: boolean;
}

export interface BatchPreview {
  variantId: number;
  variantName: string;
  quantity: number;
  unitCostPence: number;
  totalCostPence: number;
  rows: RecipeConsumption[];
  warnings: RecipeConsumption[]; // subset of rows that go negative
}

export interface MakeBatchResult {
  batchId: number;
  batchNumber: number;
  variantId: number;
  variantName: string;
  quantityMade: number;
  unitCostPenceAtProduction: number;
  warnings: RecipeConsumption[];
}

// Compute what a batch would consume without writing anything.
export function previewBatch(db: DbLike, input: MakeBatchInput): BatchPreview {
  const { variantId, quantity } = validateMakeInput(input);
  const variant = db.select().from(productVariants).where(eq(productVariants.id, variantId)).get();
  if (!variant) throw new Error(`Variant ${variantId} not found`);

  const rows = buildConsumption(db, variantId, quantity);
  const totalCostPence = rows.reduce((sum, r) => sum + r.valueConsumedPence, 0);
  const unitCostPence = quantity > 0 ? bankersRoundToPence(totalCostPence / quantity) : 0;

  return {
    variantId,
    variantName: variant.variant_name,
    quantity,
    unitCostPence,
    totalCostPence,
    rows,
    warnings: rows.filter((r) => r.isNegative),
  };
}

export function makeBatch(db: Db, input: MakeBatchInput): MakeBatchResult {
  const { variantId, quantity } = validateMakeInput(input);

  return db.transaction((tx) => {
    const variant = tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .get();
    if (!variant) throw new Error(`Variant ${variantId} not found`);

    const consumption = buildConsumption(tx, variantId, quantity);
    if (consumption.length === 0) {
      throw new Error(`Variant ${variantId} has no recipe rows; nothing to consume`);
    }

    const totalCostPence = consumption.reduce((s, r) => s + r.valueConsumedPence, 0);
    const unitCostPenceAtProduction = bankersRoundToPence(totalCostPence / quantity);

    // 7. Next batch_number for this variant (single-user, single-tx -> safe).
    const maxRow = tx
      .select({ max: sql<number>`COALESCE(MAX(${batches.batch_number}), 0)` })
      .from(batches)
      .where(eq(batches.variant_id, variantId))
      .get();
    const nextBatchNumber = (maxRow?.max ?? 0) + 1;

    const batchRow = tx
      .insert(batches)
      .values({
        variant_id: variantId,
        batch_number: nextBatchNumber,
        quantity_made: quantity,
        unit_cost_pence_at_production: unitCostPenceAtProduction,
        notes: input.notes ?? null,
      })
      .returning()
      .get();

    // 3-5. For each row: write movement + decrement component stock/value.
    for (const row of consumption) {
      const comp = tx.select().from(components).where(eq(components.id, row.componentId)).get();
      if (!comp) throw new Error(`Component ${row.componentId} not found mid-transaction`);

      if (comp.unit === 'cost_pool') {
        tx.update(components)
          .set({ stock_value_pence: (comp.stock_value_pence ?? 0) - row.valueConsumedPence })
          .where(eq(components.id, comp.id))
          .run();
      } else {
        tx.update(components)
          .set({ stock_quantity: (comp.stock_quantity ?? 0) - row.quantityConsumed })
          .where(eq(components.id, comp.id))
          .run();
      }

      tx.insert(stockMovements)
        .values({
          component_id: comp.id,
          reason: 'production',
          quantity_delta: comp.unit === 'cost_pool' ? 0 : -row.quantityConsumed,
          value_delta_pence: -row.valueConsumedPence,
          batch_id: batchRow.id,
        })
        .run();
    }

    // 8. Bump finished-goods stock on the variant.
    tx.update(productVariants)
      .set({ stock_quantity: variant.stock_quantity + quantity })
      .where(eq(productVariants.id, variantId))
      .run();

    // Refresh the cached unit_cost_pence on the variant.
    recomputeVariantCost(tx, variantId);

    return {
      batchId: batchRow.id,
      batchNumber: batchRow.batch_number,
      variantId,
      variantName: variant.variant_name,
      quantityMade: quantity,
      unitCostPenceAtProduction,
      warnings: consumption.filter((r) => r.isNegative),
    };
  });
}

export interface BatchListItem {
  id: number;
  variantId: number;
  variantName: string;
  batchNumber: number;
  quantityMade: number;
  unitCostPenceAtProduction: number;
  producedAt: Date;
}

export function listBatches(db: DbLike): BatchListItem[] {
  return db
    .select({
      id: batches.id,
      variantId: batches.variant_id,
      variantName: productVariants.variant_name,
      batchNumber: batches.batch_number,
      quantityMade: batches.quantity_made,
      unitCostPenceAtProduction: batches.unit_cost_pence_at_production,
      producedAt: batches.produced_at,
    })
    .from(batches)
    .innerJoin(productVariants, eq(productVariants.id, batches.variant_id))
    .orderBy(desc(batches.produced_at))
    .all();
}

// -----------------------------------------------------------------------------
// internals
// -----------------------------------------------------------------------------

function validateMakeInput(input: MakeBatchInput): { variantId: number; quantity: number } {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error('quantity must be a positive integer');
  }
  return { variantId: input.variantId, quantity: input.quantity };
}

function buildConsumption(
  db: DbLike,
  variantId: number,
  quantity: number
): RecipeConsumption[] {
  const rows = db
    .select({
      componentId: components.id,
      componentName: components.name,
      unit: components.unit,
      stockQuantity: components.stock_quantity,
      stockValuePence: components.stock_value_pence,
      costPerUnitPence: components.cost_per_unit_pence,
      quantityPerUnit: recipes.quantity_per_unit,
      costPoolPencePerUnit: recipes.cost_pool_pence_per_unit,
    })
    .from(recipes)
    .innerJoin(components, eq(components.id, recipes.component_id))
    .where(eq(recipes.variant_id, variantId))
    .all();

  return rows.map((r) => {
    if (r.unit === 'cost_pool') {
      const valuePerUnit = r.costPoolPencePerUnit ?? 0;
      const valueConsumedPence = valuePerUnit * quantity;
      const newStockValuePence = (r.stockValuePence ?? 0) - valueConsumedPence;
      return {
        componentId: r.componentId,
        componentName: r.componentName,
        unit: r.unit,
        quantityConsumed: 0,
        valueConsumedPence,
        newStockQuantity: null,
        newStockValuePence,
        isNegative: newStockValuePence < 0,
      };
    }
    const qtyPerUnit = r.quantityPerUnit ?? 0;
    const quantityConsumed = qtyPerUnit * quantity;
    const fractionalValue = quantityConsumed * (r.costPerUnitPence ?? 0);
    const valueConsumedPence = bankersRoundToPence(fractionalValue);
    const newStockQuantity = (r.stockQuantity ?? 0) - quantityConsumed;
    return {
      componentId: r.componentId,
      componentName: r.componentName,
      unit: r.unit,
      quantityConsumed,
      valueConsumedPence,
      newStockQuantity,
      newStockValuePence: null,
      isNegative: newStockQuantity < 0,
    };
  });
}

// -----------------------------------------------------------------------------
// Stock log query (lives here because it's tightly coupled to movements)
// -----------------------------------------------------------------------------

export interface StockLogFilters {
  componentId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface StockLogRow {
  id: number;
  componentId: number;
  componentName: string;
  componentUnit: string;
  reason: string;
  quantityDelta: number;
  valueDeltaPence: number;
  batchId: number | null;
  notes: string | null;
  occurredAt: Date;
}

export function listStockMovements(db: DbLike, filters: StockLogFilters = {}): StockLogRow[] {
  const conditions = [];
  if (filters.componentId != null) {
    conditions.push(eq(stockMovements.component_id, filters.componentId));
  }
  if (filters.from) conditions.push(gte(stockMovements.occurred_at, filters.from));
  if (filters.to) conditions.push(lte(stockMovements.occurred_at, filters.to));

  const where = conditions.length === 0 ? undefined : and(...conditions);
  const query = db
    .select({
      id: stockMovements.id,
      componentId: stockMovements.component_id,
      componentName: components.name,
      componentUnit: components.unit,
      reason: stockMovements.reason,
      quantityDelta: stockMovements.quantity_delta,
      valueDeltaPence: stockMovements.value_delta_pence,
      batchId: stockMovements.batch_id,
      notes: stockMovements.notes,
      occurredAt: stockMovements.occurred_at,
    })
    .from(stockMovements)
    .innerJoin(components, eq(components.id, stockMovements.component_id))
    .where(where)
    .orderBy(desc(stockMovements.occurred_at))
    .limit(filters.limit ?? 1000);

  return query.all();
}
