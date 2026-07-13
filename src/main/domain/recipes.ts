import { and, eq } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { components, recipes } from '../db/schema.js';
import { recomputeVariantCost } from './costing.js';

export interface RecipeRowInput {
  variantId: number;
  componentId: number;
  quantityPerUnit?: number | null;
  costPoolPencePerUnit?: number | null;
  notes?: string | null;
}

export function listRecipeRows(db: DbLike, variantId: number) {
  return db
    .select({
      id: recipes.id,
      variantId: recipes.variant_id,
      componentId: recipes.component_id,
      quantityPerUnit: recipes.quantity_per_unit,
      costPoolPencePerUnit: recipes.cost_pool_pence_per_unit,
      notes: recipes.notes,
      componentName: components.name,
      componentUnit: components.unit,
      componentCostPerUnitPence: components.cost_per_unit_pence,
    })
    .from(recipes)
    .innerJoin(components, eq(components.id, recipes.component_id))
    .where(eq(recipes.variant_id, variantId))
    .all();
}

export function upsertRecipeRow(db: Db, input: RecipeRowInput) {
  return db.transaction((tx) => {
    const comp = tx.select().from(components).where(eq(components.id, input.componentId)).get();
    if (!comp) throw new Error(`Component ${input.componentId} not found`);

    if (comp.unit === 'cost_pool') {
      if (input.costPoolPencePerUnit == null || input.costPoolPencePerUnit < 0) {
        throw new Error('cost_pool components need costPoolPencePerUnit >= 0');
      }
      if (input.quantityPerUnit != null) {
        throw new Error('cost_pool components must not set quantityPerUnit');
      }
    } else {
      if (input.quantityPerUnit == null || input.quantityPerUnit <= 0) {
        throw new Error('measured components need quantityPerUnit > 0');
      }
      if (input.costPoolPencePerUnit != null) {
        throw new Error('measured components must not set costPoolPencePerUnit');
      }
    }

    const existing = tx
      .select()
      .from(recipes)
      .where(
        and(eq(recipes.variant_id, input.variantId), eq(recipes.component_id, input.componentId))
      )
      .get();

    let row;
    if (existing) {
      row = tx
        .update(recipes)
        .set({
          quantity_per_unit: input.quantityPerUnit ?? null,
          cost_pool_pence_per_unit: input.costPoolPencePerUnit ?? null,
          notes: input.notes ?? null,
        })
        .where(eq(recipes.id, existing.id))
        .returning()
        .get();
    } else {
      row = tx
        .insert(recipes)
        .values({
          variant_id: input.variantId,
          component_id: input.componentId,
          quantity_per_unit: input.quantityPerUnit ?? null,
          cost_pool_pence_per_unit: input.costPoolPencePerUnit ?? null,
          notes: input.notes ?? null,
        })
        .returning()
        .get();
    }

    recomputeVariantCost(tx, input.variantId);
    return row;
  });
}

export function deleteRecipeRow(db: Db, recipeId: number) {
  return db.transaction((tx) => {
    const row = tx.select().from(recipes).where(eq(recipes.id, recipeId)).get();
    if (!row) throw new Error(`Recipe row ${recipeId} not found`);
    tx.delete(recipes).where(eq(recipes.id, recipeId)).run();
    recomputeVariantCost(tx, row.variant_id);
    return { deleted: true as const, variantId: row.variant_id };
  });
}
