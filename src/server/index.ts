// Headless entry point — runs the Craft ERP web server without Electron.
// Used for LAN hosting (e.g. an LXC): the same domain logic and tRPC router
// as the desktop app, with the built Angular renderer served over HTTP.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../main/db/client.js';
import { runMigrations } from '../main/db/migrate.js';
import { assetsDir, dbPath, setDataDir } from '../main/paths.js';
import { setWebServerInfo } from '../main/web/info.js';
import { startWebServer } from '../main/web/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function firstExisting(candidates: string[], what: string): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate ${what} (looked in: ${candidates.join(', ')})`);
}

const dataDir = process.env.CRAFT_ERP_DATA_DIR ?? '/var/lib/craft-erp';
const port = Number(process.env.CRAFT_ERP_PORT ?? 7273);

setDataDir(dataDir);
mkdirSync(assetsDir(), { recursive: true });

// Deployed layout: index.js with drizzle/ and renderer/ beside it.
// Repo layout (out/server/index.js): both live at the project root / out.
const migrationsFolder = firstExisting(
  [join(__dirname, 'drizzle'), join(__dirname, '../../drizzle')],
  'drizzle migrations folder'
);
const rendererDist = firstExisting(
  [join(__dirname, 'renderer'), join(__dirname, '../renderer')],
  'built renderer (run `npm run build` first)'
);

console.log(`[server] opening DB at ${dbPath()}`);
const db = openDatabase(dbPath());
runMigrations(db, migrationsFolder);

const info = await startWebServer(db, assetsDir(), { apiPort: port, rendererDist });
setWebServerInfo(info);
console.log(`[server] craft-erp listening on ${info.urls.join(', ')}`);
