# Build: Craft Inventory & Sales Desktop App

I'm building a personal desktop app to manage stock and sales for a small craft
business (leatherwork, candles, etc.) sold at local events. Local-first, single
user, no cloud. Build this incrementally — get v0.1 working end-to-end before
adding anything from later versions.

## Stack

- **Electron** with `electron-vite` for the build setup
- **Angular 20+** (standalone components, signals) + **PrimeNG** for UI
- **better-sqlite3** for storage (synchronous, perfect for desktop)
- **Drizzle ORM** for schema and queries
- **tRPC over Electron IPC** for typed main↔renderer communication
- **TypeScript strict mode** throughout
- **Vitest** for tests on the main-process domain logic

I'm a backend TypeScript dev, weak on CSS — lean on PrimeNG components and
PrimeFlex utilities for layout, avoid bespoke styling. Use the PrimeNG Aura
preset; dark mode is a nice-to-have but not required for v0.1.

## Architecture rules

- **Main process owns everything**: DB, business logic, file paths. Renderer is
  pure UI.
- **No HTTP server inside Electron** — use IPC via `contextBridge` + tRPC's
  Electron adapter (or a minimal hand-rolled IPC bridge if that's simpler;
  document the choice).
- **DB file lives at `app.getPath('userData')/craft.db`** so it survives app
  updates and gets picked up by Time Machine.
- **Migrations**: use `drizzle-kit` generated SQL migrations, run on app boot
  before any other code touches the DB.
- **Money is stored as INTEGER pence everywhere.** Never `real` for currency.
  Format at the UI edge only.
- **Stock movements are immutable.** Corrections happen via new `adjustment`
  rows, never by editing or deleting existing rows.

## Domain model (v0.1 only — see schema spec below)

The core concepts:

- **Component** — raw material. Has a unit of measure: `each`, `mm`, `g`, `ml`,
  or `cost_pool`. The last is for things like leather that I buy irregularly
  and don't want to track by physical quantity — instead the component tracks
  a pool of money I've spent on leather, and recipes deduct a flat pence
  amount per item made.
- **Product** — the platonic thing ("Hex Wallet"). Mostly a grouping label.
- **ProductVariant** — the actual sellable SKU ("Hex Wallet — Black"). Has its
  own recipe, price, and finished-goods stock.
- **Recipe** — bill of materials. Rows linking a variant to components, with
  either a `quantity_per_unit` (for measured components) or
  `cost_pool_pence_per_unit` (for cost_pool components). Waste is baked into
  the quantity — don't model it separately.
- **Batch** — a production run. "Make 6 Hex Wallet — Black" creates one batch
  row, decrements components via stock_movements, increments variant stock,
  and snapshots the unit cost at production time. Batch numbers are
  per-variant counters (so "Hex Wallet Black #14"), not global.
- **StockMovement** — append-only audit log of every component stock change.
  Source of truth; the `stock_quantity` column on `components` is a cache
  rebuildable from this log.

## Schema

Use the Drizzle schema I've attached (`schema.ts`) as the starting point.
Don't change the shape without flagging it to me first. If you spot
something genuinely wrong (not just stylistic), call it out in a comment
at the top of the PR and proceed with your best judgement.

## Costing logic

- For **measured components**, `cost_per_unit_pence` is a **moving weighted
  average** updated on every `purchase` movement:
  `new_avg = (old_qty * old_avg + purchased_qty * purchased_cost) / (old_qty + purchased_qty)`
- For **cost_pool components**, no per-unit cost — recipes specify flat pence.
- **Variant unit cost** = sum over recipe rows of either
  `quantity_per_unit * component.cost_per_unit_pence` (measured) or
  `cost_pool_pence_per_unit` (pool).
- **Cache `unit_cost_pence` on the variant** but recompute and write it
  whenever: a recipe changes, a measured component's avg cost changes, or a
  cost_pool recipe row changes. Wrap this in a single
  `recomputeVariantCost(variantId)` function called from the right places —
  don't sprinkle the logic.

## Behaviour: making a batch

1. User picks a variant and a quantity N.
2. Compute current unit cost from the recipe.
3. For each recipe row, write a `stock_movements` row with
   `reason='production'`, negative `quantity_delta` (or zero for cost_pool),
   `value_delta_pence` reflecting cost consumed, linked to the new batch_id.
4. For cost_pool components, deduct from `stock_value_pence`.
5. For measured components, deduct from `stock_quantity`.
6. **Allow stock to go negative.** Don't block production. If anything goes
   negative, surface a warning toast in the UI listing which components are
   now negative.
7. Insert the `batches` row with `unit_cost_pence_at_production` set to the
   computed cost.
8. Increment `product_variants.stock_quantity` by N.
9. All of the above in a single SQLite transaction. Rollback on any error.

## v0.1 scope — UI

PrimeNG `p-table` for everything list-shaped. Sidebar nav via `p-menu`.
Pages:

- **Components** — table with name, unit, stock, value, avg cost, reorder
  level. Inline edit or detail panel for editing. "Receive stock" action
  that opens a small form (quantity + total cost paid) and writes a
  `purchase` movement.
- **Products** — table grouped/expandable by product, showing variants
  underneath. Variant detail page with: recipe editor, current stock, unit
  cost, price, margin %.
- **Make a batch** — pick a variant, enter quantity, see preview of what
  will be consumed, hit Make. Show the resulting batch number.
- **Stock log** — flat list of stock movements with filters by component
  and date range. Read-only.

No sales, no events, no customers, no reports, no exports in v0.1. Resist
the urge to scope creep.

## Quality bar

- **Vitest tests** for: moving-average cost calc, variant cost roll-up, the
  full "make a batch" transaction (including the negative-stock-allowed
  case). Don't test the UI for v0.1.
- **ESLint + Prettier** with sensible defaults.
- **README** with: how to run dev, how to build, where the DB lives, how to
  back it up (just copy the .db file), how to reset (delete the .db file).
- **No auth, no encryption, no telemetry.**

## Deliverables for this first pass

1. Project scaffold with electron-vite + Angular + PrimeNG building and
   launching to a blank shell window.
2. Drizzle setup with the schema from `schema.ts` and migrations running on
   boot.
3. tRPC (or IPC bridge) wired up, with one end-to-end working call from
   Angular to main process to prove the plumbing works.
4. The four v0.1 pages above, functional, ugly-but-usable.
5. Tests for the costing and batch logic.
6. README.

If anything in this spec is ambiguous or you spot a better way, **stop and
ask me before implementing the alternative** — don't silently diverge. If
something is unspecified and you need to make a call, make the call but
flag it in a `DECISIONS.md` at the project root with a one-line rationale.

Start by laying out the folder structure and the build pipeline, then the
DB layer, then the IPC layer, then one page (Components) end-to-end, then
the rest. Show me your plan before you start coding.
