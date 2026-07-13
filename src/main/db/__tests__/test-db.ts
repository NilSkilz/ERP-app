import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import type { Db } from '../client.js';

// In-memory DB for tests. Schema is created by literal CREATE statements
// so the tests don't depend on drizzle-kit having generated migrations.
// Kept in lockstep with schema.ts — if you change one, change the other.
const CREATE_SQL = `
CREATE TABLE components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,
  link TEXT,
  colour TEXT,
  size TEXT,
  pack_size INTEGER,
  stock_quantity REAL,
  stock_value_pence INTEGER,
  cost_per_unit_pence REAL,
  reorder_level REAL,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE UNIQUE INDEX components_sku_unique ON components(sku);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id INTEGER NOT NULL REFERENCES components(id),
  reason TEXT NOT NULL,
  quantity_delta REAL NOT NULL DEFAULT 0,
  value_delta_pence INTEGER NOT NULL DEFAULT 0,
  batch_id INTEGER REFERENCES batches(id),
  notes TEXT,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX stock_movements_component_idx ON stock_movements(component_id);
CREATE INDEX stock_movements_batch_idx ON stock_movements(batch_id);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  target_stock INTEGER,
  price_pence INTEGER NOT NULL,
  unit_cost_pence INTEGER,
  notes TEXT,
  labour_hours_per_unit REAL,
  build_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  labour_hourly_rate_pence INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO settings (id) VALUES (1);
CREATE TABLE variant_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX variant_attachments_variant_idx ON variant_attachments(variant_id);
CREATE UNIQUE INDEX product_variants_sku_unique ON product_variants(sku);
CREATE INDEX product_variants_product_idx ON product_variants(product_id);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  component_id INTEGER NOT NULL REFERENCES components(id),
  quantity_per_unit REAL,
  cost_pool_pence_per_unit INTEGER,
  notes TEXT
);
CREATE UNIQUE INDEX recipes_variant_component_unique
  ON recipes(variant_id, component_id);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  batch_number INTEGER NOT NULL,
  quantity_made INTEGER NOT NULL,
  unit_cost_pence_at_production INTEGER NOT NULL,
  notes TEXT,
  produced_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX batches_variant_number_unique
  ON batches(variant_id, batch_number);
`;

export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  // FKs are deferred at insert time in SQLite, so the forward ref from
  // stock_movements.batch_id to batches resolves fine even though batches is
  // declared further down in the script.
  sqlite.exec(CREATE_SQL);
  return drizzle(sqlite, { schema }) as Db;
}
