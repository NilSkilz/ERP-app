import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { products, productVariants } from '../db/schema.js';
import { recomputeVariantCost } from './costing.js';

export interface ProductInput {
  name: string;
  category?: string | null;
  description?: string | null;
}

export interface ProductPatch {
  name?: string;
  category?: string | null;
  description?: string | null;
}

export interface VariantInput {
  productId: number;
  sku?: string; // optional — auto-generated from product+variant name if blank
  variantName: string;
  pricePence: number;
  targetStock?: number | null;
  labourHoursPerUnit?: number | null;
  notes?: string | null;
}

export interface VariantPatch {
  variantName?: string;
  sku?: string;
  pricePence?: number;
  targetStock?: number | null;
  labourHoursPerUnit?: number | null;
  notes?: string | null;
}

export function listProducts(db: DbLike) {
  return db
    .select()
    .from(products)
    .where(isNull(products.archived_at))
    .orderBy(asc(products.name))
    .all();
}

export function listVariantsForProduct(db: DbLike, productId: number) {
  return db
    .select()
    .from(productVariants)
    .where(
      and(eq(productVariants.product_id, productId), isNull(productVariants.archived_at))
    )
    .orderBy(asc(productVariants.variant_name))
    .all();
}

export function listProductsWithVariants(db: DbLike) {
  const allProducts = listProducts(db);
  const allVariants = db
    .select()
    .from(productVariants)
    .where(isNull(productVariants.archived_at))
    .all();

  return allProducts.map((p) => ({
    ...p,
    variants: allVariants.filter((v) => v.product_id === p.id),
  }));
}

export function getVariant(db: DbLike, id: number) {
  const row = db.select().from(productVariants).where(eq(productVariants.id, id)).get();
  if (!row) throw new Error(`Variant ${id} not found`);
  return row;
}

export function createProduct(db: Db, input: ProductInput) {
  if (!input.name?.trim()) throw new Error('Product name is required');
  return db
    .insert(products)
    .values({
      name: input.name,
      category: input.category ?? null,
      description: input.description ?? null,
    })
    .returning()
    .get();
}

export function updateProduct(db: DbLike, id: number, patch: ProductPatch) {
  const current = db.select().from(products).where(eq(products.id, id)).get();
  if (!current) throw new Error(`Product ${id} not found`);
  return db
    .update(products)
    .set({
      name: patch.name ?? current.name,
      category: patch.category === undefined ? current.category : patch.category,
      description: patch.description === undefined ? current.description : patch.description,
    })
    .where(eq(products.id, id))
    .returning()
    .get();
}

// Soft-delete: history (batches, movements, recipes) is preserved; row just
// stops appearing in normal lists. Cascades to its variants.
export function archiveProduct(db: Db, id: number) {
  return db.transaction((tx) => {
    const current = tx.select().from(products).where(eq(products.id, id)).get();
    if (!current) throw new Error(`Product ${id} not found`);
    const now = new Date();
    tx.update(products).set({ archived_at: now }).where(eq(products.id, id)).run();
    tx.update(productVariants)
      .set({ archived_at: now })
      .where(
        and(eq(productVariants.product_id, id), isNull(productVariants.archived_at))
      )
      .run();
    return { archived: true as const };
  });
}

// Sets the variant's finished-goods stock to a specific value. No audit row
// is written — variants don't have a movements table yet (see DECISIONS.md).
// v0.2 sales work will replace this with a proper movement-logged version.
export function adjustVariantStock(
  db: DbLike,
  input: { variantId: number; newQuantity: number }
) {
  if (!Number.isInteger(input.newQuantity)) {
    throw new Error('newQuantity must be an integer');
  }
  if (input.newQuantity < 0) {
    throw new Error('Variant stock cannot be negative');
  }
  const current = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, input.variantId))
    .get();
  if (!current) throw new Error(`Variant ${input.variantId} not found`);
  return db
    .update(productVariants)
    .set({ stock_quantity: input.newQuantity })
    .where(eq(productVariants.id, input.variantId))
    .returning()
    .get();
}

export function updateVariantBuildNotes(
  db: DbLike,
  variantId: number,
  buildNotes: string | null
) {
  const current = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .get();
  if (!current) throw new Error(`Variant ${variantId} not found`);
  return db
    .update(productVariants)
    .set({ build_notes: buildNotes })
    .where(eq(productVariants.id, variantId))
    .returning()
    .get();
}

export function archiveVariant(db: DbLike, id: number) {
  const current = db.select().from(productVariants).where(eq(productVariants.id, id)).get();
  if (!current) throw new Error(`Variant ${id} not found`);
  db.update(productVariants)
    .set({ archived_at: new Date() })
    .where(eq(productVariants.id, id))
    .run();
  return { archived: true as const };
}

export function createVariant(db: Db, input: VariantInput) {
  if (!input.variantName?.trim()) throw new Error('Variant name is required');
  if (!(input.pricePence >= 0)) throw new Error('pricePence must be >= 0');

  return db.transaction((tx) => {
    const sku = input.sku?.trim() || nextNumericSku(tx);
    const inserted = tx
      .insert(productVariants)
      .values({
        product_id: input.productId,
        sku,
        variant_name: input.variantName,
        price_pence: input.pricePence,
        target_stock: input.targetStock ?? null,
        labour_hours_per_unit: input.labourHoursPerUnit ?? null,
        notes: input.notes ?? null,
      })
      .returning()
      .get();

    if (input.labourHoursPerUnit && input.labourHoursPerUnit > 0) {
      recomputeVariantCost(tx, inserted.id);
    }
    return inserted;
  });
}

// Walks the variants table for the highest 4+-digit numeric SKU and adds 1,
// zero-padded to 4 digits. Manually-entered non-numeric SKUs are ignored, so
// a hand-set SKU like "HW-BLK" never collides with the auto-gen counter.
// Archived variants still occupy their SKU (the unique index is unconditional),
// so the counter naturally skips reused numbers.
function nextNumericSku(db: DbLike): string {
  const all = db.select({ sku: productVariants.sku }).from(productVariants).all();
  let max = 0;
  for (const { sku } of all) {
    if (/^\d+$/.test(sku)) {
      const n = parseInt(sku, 10);
      if (n > max) max = n;
    }
  }
  return String(max + 1).padStart(4, '0');
}

export function updateVariant(db: DbLike, id: number, patch: VariantPatch) {
  const current = getVariant(db, id);
  const labourChanged =
    patch.labourHoursPerUnit !== undefined &&
    patch.labourHoursPerUnit !== current.labour_hours_per_unit;
  const updated = db
    .update(productVariants)
    .set({
      variant_name: patch.variantName ?? current.variant_name,
      sku: patch.sku ?? current.sku,
      price_pence: patch.pricePence ?? current.price_pence,
      target_stock:
        patch.targetStock === undefined ? current.target_stock : patch.targetStock,
      labour_hours_per_unit:
        patch.labourHoursPerUnit === undefined
          ? current.labour_hours_per_unit
          : patch.labourHoursPerUnit,
      notes: patch.notes === undefined ? current.notes : patch.notes,
    })
    .where(eq(productVariants.id, id))
    .returning()
    .get();

  if (labourChanged) {
    recomputeVariantCost(db, id);
  }
  return updated;
}
