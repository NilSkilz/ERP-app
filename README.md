# Craft ERP

Local-first inventory and sales desktop app for a small craft business
(leatherwork, candles, etc.). Single user, no cloud, no telemetry.

## Stack

- **Electron** packaged with `electron-vite`
- **Angular 20** standalone components + signals, **PrimeNG** (Aura preset)
- **better-sqlite3** + **Drizzle ORM**
- **tRPC** over Electron IPC (`electron-trpc`) with **zod** input validation
- **Vitest** for main-process domain tests

The main process owns the database, business logic, and file paths. The
renderer is pure UI talking to the main process over a typed tRPC link.

## Where things live

```
src/
├── main/        Node process: DB, domain logic, IPC router
├── preload/     contextBridge — exposes the tRPC link
└── renderer/    Angular app (PrimeNG UI)
drizzle/         Generated SQL migrations (run on app boot)
```

## Getting started

```bash
npm install
npm run db:generate    # generate the SQL migration files into drizzle/
npm run dev            # launches the Electron app with hot reload
```

The first launch creates the DB at `~/Library/Application Support/craft-erp/craft.db`
(macOS path; the Electron `userData` directory). It also gets picked up by
Time Machine.

## Useful commands

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Run Electron with hot reload                            |
| `npm run build`        | Build all three targets (main, preload, renderer)       |
| `npm run package:mac`  | Build a macOS `.app` via electron-builder               |
| `npm test`             | Run vitest suites (domain logic only)                   |
| `npm run typecheck`    | TypeScript --noEmit for both Node and web tsconfigs     |
| `npm run lint`         | ESLint                                                  |
| `npm run format`       | Prettier --write                                        |
| `npm run db:generate`  | drizzle-kit generate (after schema changes)             |
| `npm run db:studio`    | drizzle-kit studio (browse the DB)                      |

## Backup and reset

- **Backup**: copy `craft.db` from the `userData` folder. Time Machine already
  does this hourly.
- **Reset**: quit the app and delete `craft.db`. Next launch starts fresh.

On macOS the file lives at:
```
~/Library/Application Support/craft-erp/craft.db
```

## Architecture notes

- **Money is stored as INTEGER pence**, formatted at the UI edge via `MoneyPipe`.
  The one exception is `components.cost_per_unit_pence`, kept as `real`
  because a moving average produces fractional pence. See `DECISIONS.md`.
- **Stock movements are immutable.** Corrections happen via new
  `adjustment` rows, never by editing existing ones.
- **`recomputeVariantCost`** is the single owner of variant cost roll-up.
  It runs whenever a recipe or upstream component cost changes.
- **`makeBatch` is one SQLite transaction.** Negative stock is allowed by
  design; the result includes a `warnings` array the UI surfaces as a toast.

## Adding a feature

1. Add or change the schema in `src/main/db/schema.ts`.
2. `npm run db:generate` to produce a migration.
3. Add a domain function under `src/main/domain/` with a vitest spec.
4. Expose it via the tRPC router in `src/main/ipc/router.ts`.
5. Call it from the renderer via `trpc.<router>.<procedure>`.
