import { asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { components, stockMovements, type Unit } from '../db/schema.js';
import { quantityConversionFactor } from '../../shared/units.js';
import { recomputeVariantCostsForComponent, updateMovingAverage } from './costing.js';
import { bankersRoundToPence } from './money.js';

export interface ComponentInput {
  name: string;
  sku?: string | null;
  unit: Unit;
  link?: string | null;
  colour?: string | null;
  size?: string | null;
  packSize?: number | null;
  stockQuantity?: number | null;
  stockValuePence?: number | null;
  costPerUnitPence?: number | null;
  reorderLevel?: number | null;
  notes?: string | null;
}

export function listComponents(db: DbLike) {
  return db
    .select()
    .from(components)
    .where(isNull(components.archived_at))
    .orderBy(asc(components.name))
    .all();
}

export function getComponent(db: DbLike, id: number) {
  const row = db.select().from(components).where(eq(components.id, id)).get();
  if (!row) throw new Error(`Component ${id} not found`);
  return row;
}

export function createComponent(db: Db, input: ComponentInput) {
  validateComponentShape(input);
  return db.transaction((tx) => {
    const insert = tx
      .insert(components)
      .values({
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit,
        link: input.link ?? null,
        colour: input.colour ?? null,
        size: input.size ?? null,
        pack_size: input.packSize ?? null,
        stock_quantity: input.unit === 'cost_pool' ? null : (input.stockQuantity ?? 0),
        stock_value_pence: input.unit === 'cost_pool' ? (input.stockValuePence ?? 0) : null,
        cost_per_unit_pence: input.unit === 'cost_pool' ? null : (input.costPerUnitPence ?? null),
        reorder_level: input.reorderLevel ?? null,
        notes: input.notes ?? null,
      })
      .returning()
      .get();

    if (insert.unit === 'cost_pool') {
      if ((insert.stock_value_pence ?? 0) !== 0) {
        tx.insert(stockMovements)
          .values({
            component_id: insert.id,
            reason: 'opening',
            quantity_delta: 0,
            value_delta_pence: insert.stock_value_pence ?? 0,
            notes: 'Opening balance',
          })
          .run();
      }
    } else if ((insert.stock_quantity ?? 0) !== 0) {
      const value = bankersRoundToPence(
        (insert.stock_quantity ?? 0) * (insert.cost_per_unit_pence ?? 0)
      );
      tx.insert(stockMovements)
        .values({
          component_id: insert.id,
          reason: 'opening',
          quantity_delta: insert.stock_quantity ?? 0,
          value_delta_pence: value,
          notes: 'Opening balance',
        })
        .run();
    }

    return insert;
  });
}

export interface ComponentPatch {
  name?: string;
  sku?: string | null;
  link?: string | null;
  colour?: string | null;
  size?: string | null;
  packSize?: number | null;
  unit?: Unit;
  // Manual override of the moving-average cost (fractional pence allowed).
  // Bypasses the audit trail — use "Receive stock" for purchases that should
  // be reflected in movements. Useful only for fixing setup-time mistakes.
  costPerUnitPence?: number | null;
  reorderLevel?: number | null;
  notes?: string | null;
}

export function updateComponent(db: Db, id: number, patch: ComponentPatch) {
  return db.transaction((tx) => {
    const current = getComponent(tx, id);
    const nextUnit = patch.unit ?? current.unit;
    const unitChanged = nextUnit !== current.unit;
    const switchingToPool = unitChanged && nextUnit === 'cost_pool';
    const switchingFromPool = unitChanged && current.unit === 'cost_pool';
    const conversionFactor =
      unitChanged && !switchingToPool && !switchingFromPool
        ? quantityConversionFactor(current.unit, nextUnit)
        : null;

    // Resolve the cost/stock cache fields based on the (possibly new) unit.
    let stockQuantity: number | null | undefined = undefined;
    let stockValuePence: number | null | undefined = undefined;
    let costPerUnitPence: number | null | undefined = undefined;

    if (switchingToPool) {
      // measured -> cost_pool: drop quantity-based fields, seed pool value at 0
      stockQuantity = null;
      costPerUnitPence = null;
      stockValuePence = 0;
    } else if (switchingFromPool) {
      // cost_pool -> measured: drop pool value, seed quantity at 0
      stockValuePence = null;
      stockQuantity = 0;
      costPerUnitPence = patch.costPerUnitPence ?? null;
    } else if (conversionFactor != null) {
      // Compatible measured-unit switch (mm<->m, g<->kg, ml<->L): rescale
      // stock and cost so the underlying physical/monetary amounts stay equal.
      // e.g. mm -> m: stock /1000, cost *1000. No audit-trail movement.
      stockQuantity = (current.stock_quantity ?? 0) * conversionFactor;
      if (current.cost_per_unit_pence != null) {
        costPerUnitPence = current.cost_per_unit_pence / conversionFactor;
      }
    } else if (unitChanged) {
      // Incompatible measured-unit switch (e.g. mm -> g): reset stock.
      stockQuantity = 0;
      costPerUnitPence = patch.costPerUnitPence ?? null;
    } else if (patch.costPerUnitPence !== undefined && nextUnit !== 'cost_pool') {
      // No unit change, but explicit cost override.
      costPerUnitPence = patch.costPerUnitPence;
    }

    const updated = tx
      .update(components)
      .set({
        name: patch.name ?? current.name,
        sku: patch.sku === undefined ? current.sku : patch.sku,
        link: patch.link === undefined ? current.link : patch.link,
        colour: patch.colour === undefined ? current.colour : patch.colour,
        size: patch.size === undefined ? current.size : patch.size,
        pack_size: patch.packSize === undefined ? current.pack_size : patch.packSize,
        unit: nextUnit,
        ...(stockQuantity !== undefined ? { stock_quantity: stockQuantity } : {}),
        ...(stockValuePence !== undefined ? { stock_value_pence: stockValuePence } : {}),
        ...(costPerUnitPence !== undefined ? { cost_per_unit_pence: costPerUnitPence } : {}),
        reorder_level:
          patch.reorderLevel === undefined ? current.reorder_level : patch.reorderLevel,
        notes: patch.notes === undefined ? current.notes : patch.notes,
      })
      .where(eq(components.id, id))
      .returning()
      .get();

    // Anything that touches cost/unit changes downstream variant costs.
    if (unitChanged || costPerUnitPence !== undefined) {
      recomputeVariantCostsForComponent(tx, id);
    }

    return updated;
  });
}

export interface PurchaseInput {
  componentId: number;
  quantity?: number; // ignored for cost_pool; required > 0 for measured
  totalCostPence: number;
  notes?: string | null;
}

export function purchaseComponent(db: Db, input: PurchaseInput) {
  if (input.totalCostPence < 0) throw new Error('totalCostPence cannot be negative');

  return db.transaction((tx) => {
    const comp = tx.select().from(components).where(eq(components.id, input.componentId)).get();
    if (!comp) throw new Error(`Component ${input.componentId} not found`);

    if (comp.unit === 'cost_pool') {
      const newValue = (comp.stock_value_pence ?? 0) + input.totalCostPence;
      tx.update(components)
        .set({ stock_value_pence: newValue })
        .where(eq(components.id, comp.id))
        .run();
    } else {
      if (!(input.quantity && input.quantity > 0)) {
        throw new Error('quantity must be > 0 for measured components');
      }
      const { newQuantity, newAverage } = updateMovingAverage(
        comp.stock_quantity,
        comp.cost_per_unit_pence,
        input.quantity,
        input.totalCostPence
      );
      tx.update(components)
        .set({
          stock_quantity: newQuantity,
          cost_per_unit_pence: newAverage,
        })
        .where(eq(components.id, comp.id))
        .run();
    }

    const movement = tx
      .insert(stockMovements)
      .values({
        component_id: comp.id,
        reason: 'purchase',
        quantity_delta: comp.unit === 'cost_pool' ? 0 : (input.quantity ?? 0),
        value_delta_pence: input.totalCostPence,
        notes: input.notes ?? null,
      })
      .returning()
      .get();

    recomputeVariantCostsForComponent(tx, comp.id);

    return movement;
  });
}

export interface AdjustmentInput {
  componentId: number;
  quantityDelta?: number;
  valueDeltaPence?: number;
  reason?: 'adjustment' | 'waste';
  notes?: string | null;
}

export function adjustComponentStock(db: Db, input: AdjustmentInput) {
  return db.transaction((tx) => {
    const comp = tx.select().from(components).where(eq(components.id, input.componentId)).get();
    if (!comp) throw new Error(`Component ${input.componentId} not found`);

    const qDelta = input.quantityDelta ?? 0;
    const vDelta = input.valueDeltaPence ?? 0;

    if (comp.unit === 'cost_pool') {
      const newValue = (comp.stock_value_pence ?? 0) + vDelta;
      tx.update(components)
        .set({ stock_value_pence: newValue })
        .where(eq(components.id, comp.id))
        .run();
    } else {
      const newQty = (comp.stock_quantity ?? 0) + qDelta;
      tx.update(components)
        .set({ stock_quantity: newQty })
        .where(eq(components.id, comp.id))
        .run();
    }

    return tx
      .insert(stockMovements)
      .values({
        component_id: comp.id,
        reason: input.reason ?? 'adjustment',
        quantity_delta: comp.unit === 'cost_pool' ? 0 : qDelta,
        value_delta_pence: vDelta,
        notes: input.notes ?? null,
      })
      .returning()
      .get();
  });
}

function validateComponentShape(input: ComponentInput): void {
  if (!input.name?.trim()) throw new Error('Component name is required');
  if (input.unit === 'cost_pool') {
    if (input.stockQuantity != null) {
      throw new Error('cost_pool components do not use stockQuantity');
    }
    if (input.costPerUnitPence != null) {
      throw new Error('cost_pool components do not use costPerUnitPence');
    }
  } else if (input.stockValuePence != null) {
    throw new Error('measured components do not use stockValuePence');
  }
}
