import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Money & units
// ---------------------------------------------------------------------------
// Store money as INTEGER pence. Floats + currency = pain. A `real` column
// will bite you the first time 0.1 + 0.2 happens in a sum() over 200 rows.
// Helper: pounds(149) -> "£1.49" in the UI layer.
//
// Units of measure are an enum-ish text column. SQLite has no real enums,
// but a CHECK constraint keeps it honest.

export const UNITS = ['each', 'mm', 'm', 'g', 'kg', 'ml', 'L', 'cost_pool'] as const;
export type Unit = (typeof UNITS)[number];

// ---------------------------------------------------------------------------
// Components — the raw materials
// ---------------------------------------------------------------------------
// `unit` defines what `stock_quantity` means:
//   each       -> integer count (rivets, blanks, buckles)
//   mm         -> length in millimetres (biothane, paracord, webbing)
//   g          -> grams (wax, dye powder)
//   ml         -> millilitres (fragrance oil, finish)
//   cost_pool  -> stock_quantity is unused; stock_value_pence is the truth
//                 (this is the "leather as money pool" trick)
//
// `cost_per_unit_pence` is the *current* moving-average cost. Updated on
// every stock receipt. For cost_pool components, this is meaningless —
// recipes specify a flat pence cost instead.

export const components = sqliteTable(
  'components',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    sku: text('sku'), // optional internal code, e.g. "LTH-VEG-BROWN"
    unit: text('unit', { enum: UNITS }).notNull(),

    // Where you buy it (URL) + per-component descriptive attributes.
    link: text('link'),
    colour: text('colour'),
    size: text('size'),

    // Pack size (how many individual units come in one supplier pack).
    // UX aid for the receive form — stock is still tracked in `unit`.
    pack_size: integer('pack_size'),

    // Physical stock (for measured units). NULL for cost_pool.
    stock_quantity: real('stock_quantity'),

    // Money pool stock (for cost_pool units). NULL for measured units.
    stock_value_pence: integer('stock_value_pence'),

    // Moving-average cost. NULL for cost_pool.
    cost_per_unit_pence: real('cost_per_unit_pence'),

    // Threshold for "running low" warnings. Optional.
    reorder_level: real('reorder_level'),

    notes: text('notes'),

    created_at: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    archived_at: integer('archived_at', { mode: 'timestamp' }),
  },
  (t) => ({
    skuIdx: uniqueIndex('components_sku_unique').on(t.sku),
  })
);

// ---------------------------------------------------------------------------
// Stock movements — the audit trail
// ---------------------------------------------------------------------------
// Every change to component stock is a row here. Current stock_quantity on
// the component is a denormalised cache; this table is the source of truth.
// You can rebuild component stock from sum(quantity_delta) at any point.
//
// reason values:
//   purchase   -> you bought more (quantity_delta positive, cost_pence set)
//   production -> consumed by a batch (negative, links to batches.id)
//   adjustment -> manual correction (either sign, optional notes)
//   waste      -> spillage, breakage, etc (negative)
//   opening    -> initial stock load when you set up the app (positive)
//
// For cost_pool components, quantity_delta is 0 and value_delta_pence carries
// the change. For measured components, value_delta_pence is the total cost
// of *this movement* (so for purchases: how much you paid; for production:
// quantity_delta * cost_per_unit at the time, for valuation reports).

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    component_id: integer('component_id')
      .notNull()
      .references(() => components.id),
    reason: text('reason', {
      enum: ['purchase', 'production', 'adjustment', 'waste', 'opening'],
    }).notNull(),
    quantity_delta: real('quantity_delta').notNull().default(0),
    value_delta_pence: integer('value_delta_pence').notNull().default(0),

    // Optional links — exactly one of these will be set depending on reason.
    batch_id: integer('batch_id').references(() => batches.id),

    notes: text('notes'),
    occurred_at: integer('occurred_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    componentIdx: index('stock_movements_component_idx').on(t.component_id),
    batchIdx: index('stock_movements_batch_idx').on(t.batch_id),
  })
);

// ---------------------------------------------------------------------------
// Products & variants
// ---------------------------------------------------------------------------
// Product = the platonic thing ("Hex Wallet"). Mostly for UI grouping.
// ProductVariant = the actual sellable SKU with its own recipe, price, stock.

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  category: text('category'), // free text, e.g. "leather", "candle"
  description: text('description'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  archived_at: integer('archived_at', { mode: 'timestamp' }),
});

export const productVariants = sqliteTable(
  'product_variants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id),
    sku: text('sku').notNull(),
    variant_name: text('variant_name').notNull(), // "Black", "Tan", "Vanilla 200g"

    // Finished-goods stock — incremented by batches, decremented by sales.
    stock_quantity: integer('stock_quantity').notNull().default(0),

    // Desired on-hand stock level. NULL = not tracked.
    target_stock: integer('target_stock'),

    // Pricing — what you charge.
    price_pence: integer('price_pence').notNull(),

    // Cached unit cost from latest recipe roll-up. Recomputed when recipe
    // or component costs change. Useful for margin display without joining
    // four tables every time.
    unit_cost_pence: integer('unit_cost_pence'),

    notes: text('notes'),

    // Hours to make one of these (combined with settings.labour_hourly_rate_pence).
    labour_hours_per_unit: real('labour_hours_per_unit'),

    // Free-form construction instructions (markdown-friendly text).
    build_notes: text('build_notes'),
    created_at: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    archived_at: integer('archived_at', { mode: 'timestamp' }),
  },
  (t) => ({
    skuIdx: uniqueIndex('product_variants_sku_unique').on(t.sku),
    productIdx: index('product_variants_product_idx').on(t.product_id),
  })
);

// ---------------------------------------------------------------------------
// Recipes — bill of materials, per variant
// ---------------------------------------------------------------------------
// Each row: "this variant needs X of this component to make one unit".
// For cost_pool components, set cost_pool_pence_per_unit instead of quantity.
// Waste is baked into the quantity — don't model it separately.
//
// Example rows for one "Hex Wallet — Black" variant:
//   { component: "veg leather pool",  cost_pool_pence_per_unit: 250 }
//   { component: "rivets",            quantity_per_unit: 4 }
//   { component: "black thread spool",quantity_per_unit: 800 }  -- 800mm
//   { component: "edge paint",        quantity_per_unit: 2 }    -- 2ml

export const recipes = sqliteTable(
  'recipes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    variant_id: integer('variant_id')
      .notNull()
      .references(() => productVariants.id),
    component_id: integer('component_id')
      .notNull()
      .references(() => components.id),

    // For measured components: how much you use per unit made.
    quantity_per_unit: real('quantity_per_unit'),

    // For cost_pool components: how much money to deduct per unit made.
    cost_pool_pence_per_unit: integer('cost_pool_pence_per_unit'),

    notes: text('notes'),
  },
  (t) => ({
    variantComponentIdx: uniqueIndex('recipes_variant_component_unique').on(
      t.variant_id,
      t.component_id
    ),
  })
);

// ---------------------------------------------------------------------------
// Batches — production runs
// ---------------------------------------------------------------------------
// You hit "Make 6 Hex Wallet — Black" and you get a batch row + the matching
// stock_movements rows + a +6 to variant.stock_quantity.
//
// `batch_number` is a per-variant counter so you can say "Hex Wallet Black #14"
// rather than a global ID that means nothing.

// App-wide settings (single-row table).
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  labour_hourly_rate_pence: integer('labour_hourly_rate_pence').notNull().default(0),
  updated_at: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Variant attachments — technical diagrams, photos, build references.
// Files live on disk under userData/assets/<storage_path>.
export const variantAttachments = sqliteTable(
  'variant_attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    variant_id: integer('variant_id')
      .notNull()
      .references(() => productVariants.id),
    filename: text('filename').notNull(),
    storage_path: text('storage_path').notNull(),
    mime_type: text('mime_type').notNull(),
    size_bytes: integer('size_bytes').notNull(),
    caption: text('caption'),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    variantIdx: index('variant_attachments_variant_idx').on(t.variant_id),
  })
);

export const batches = sqliteTable(
  'batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    variant_id: integer('variant_id')
      .notNull()
      .references(() => productVariants.id),
    batch_number: integer('batch_number').notNull(),
    quantity_made: integer('quantity_made').notNull(),

    // Snapshot of unit cost at time of production. Doesn't move when
    // component costs change later — this is the truth for this batch.
    unit_cost_pence_at_production: integer('unit_cost_pence_at_production').notNull(),

    notes: text('notes'),
    produced_at: integer('produced_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    variantBatchIdx: uniqueIndex('batches_variant_number_unique').on(
      t.variant_id,
      t.batch_number
    ),
  })
);
