# Decisions log

One-line rationale per decision so we can re-read this later and not have to
re-litigate. New decisions go at the top.

## 2026-05-18 — kept `components.cost_per_unit_pence` as `real`

The spec says "money is stored as INTEGER pence everywhere" but the schema
declares this column as `real`. Reading it as intentional: a moving weighted
average produces genuinely fractional pence, and rounding on every purchase
would drift the cost basis over time. We round to integer pence only at the
*cached snapshot* fields (`product_variants.unit_cost_pence`,
`batches.unit_cost_pence_at_production`, `stock_movements.value_delta_pence`).

## 2026-05-18 — banker's rounding (round half to even) for pence collapse

Applied wherever fractional pence become integer pence. Minimises bias across
many small roll-ups. Chosen over round-half-up after explicit confirmation.

## 2026-05-18 — switched from `electron-trpc` to a hand-rolled IPC bridge

Originally chose `electron-trpc` for ergonomics, but its 0.7.x main bundle
imports `ipcMain`, `contextBridge`, and `ipcRenderer` from a single `electron`
module. Electron 33's ESM module only exposes the symbols valid for the current
process — the main process has no `ipcRenderer` export — so the package fails
to load.

Replaced with ~50 lines of glue: `appRouter.createCaller()` on the main side
behind a single `ipcMain.handle('trpc:invoke', ...)`, a `contextBridge`-exposed
`erpTrpc.invoke()` in the preload, and a custom `TRPCLink` in the renderer
that round-trips input and output through superjson. Renderer ergonomics are
identical (`trpc.components.list.query()` etc.) and the type-only `AppRouter`
import is still erased at build time.

## 2026-05-18 — per-row rounding on production movements; sum-then-round on the batch snapshot

The per-row `stock_movements.value_delta_pence` rows are each rounded
independently from `quantity * cost_per_unit`. The batch's
`unit_cost_pence_at_production` is computed as `round(sum(per-row values) /
quantity)`. The two can differ by up to one penny per recipe row. This is fine
for a small-craft scale; documented here so we don't chase phantom audit gaps.

## 2026-05-18 — null component costs treated as zero in the roll-up

If a measured component has `cost_per_unit_pence = NULL` (never purchased,
never adjusted), `computeVariantUnitCostFractional` treats it as 0 rather
than throwing. The variant's cost is then understated; this is more useful
than blocking the roll-up. If we want a louder signal later, surface it as a
warning at the UI.

## 2026-05-18 — measured-component opening stock auto-creates an `opening` movement

When `createComponent` is given a non-zero opening quantity (or pool value
for `cost_pool`), we also write an `opening` row to `stock_movements` so the
audit trail starts from a defensible state. The `stock_quantity` cache and
the movement log agree from day one.

## 2026-05-18 — hash-based router in the renderer

`provideRouter(appRoutes, withHashLocation())` so the renderer survives the
`file://` load Electron uses in production. Avoids needing a custom protocol
handler for path-style routing.

## 2026-05-18 — test DB seeded with literal CREATE statements

`src/main/db/__tests__/test-db.ts` builds the schema with hand-written DDL
mirroring `schema.ts`. Avoids requiring `npm run db:generate` to have run
before `npm test`. Cost: duplication. Mitigation: change-both-or-neither.

## 2026-05-18 — `quantity` is optional on `components.purchase` for cost_pool

`cost_pool` components don't track physical quantity, so the receive-stock
form only collects total cost paid. Backend `purchaseComponent` ignores
`quantity` for cost_pool; for measured it still requires `quantity > 0`.
