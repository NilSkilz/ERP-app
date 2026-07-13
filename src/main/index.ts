import { app, BrowserWindow, protocol, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, sep } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { attachIpcRouter } from './ipc/server.js';
import { startWebServer, type WebServerInfo } from './web/server.js';

export let webServerInfo: WebServerInfo | null = null;

// Custom protocol used by the renderer to load variant attachment images
// without having to base64-encode them through every render. Privileged
// schemes must be registered BEFORE app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'craft-asset',
    privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
  },
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In production the migrations folder ships under resources/.
// In dev (electron-vite) it sits at the project root /drizzle.
function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '../../drizzle'),
    join(process.resourcesPath ?? '', 'drizzle'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate drizzle migrations folder (looked in: ${candidates.join(', ')})`);
}

function createBrowserWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Craft ERP',
    webPreferences: {
      // electron-vite emits the preload as .mjs (project is "type": "module").
      // Sandbox is off so the ESM preload can use Node-style imports.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  return window;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  if (!existsSync(userData)) mkdirSync(userData, { recursive: true });
  const dbPath = join(userData, 'craft.db');
  const assetsRoot = join(userData, 'assets');
  if (!existsSync(assetsRoot)) mkdirSync(assetsRoot, { recursive: true });
  console.log(`[main] opening DB at ${dbPath}`);

  // Resolve craft-asset:///variants/<id>/<file> -> file under userData/assets.
  // Reading via fs instead of net.fetch sidesteps ERR_FILE_NOT_FOUND quirks
  // around URL-encoded spaces and case-sensitivity differences.
  const MIME_BY_EXT: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
  };

  protocol.handle('craft-asset', async (request) => {
    // Avoid `new URL(...).pathname` here: for non-special schemes the URL
    // parser will treat the first path segment as a host (so
    // craft-asset:///variants/2/foo.png ends up with pathname /2/foo.png and
    // `variants` is silently lost). Strip the scheme manually instead.
    let relative = request.url.replace(/^craft-asset:\/+/i, '');
    relative = relative.split('?')[0].split('#')[0];
    relative = decodeURIComponent(relative).replace(/^\/+/, '');
    const absolute = join(assetsRoot, relative);
    const safePrefix = assetsRoot + sep;
    if (!absolute.startsWith(safePrefix)) {
      console.warn(`[craft-asset] rejected outside-assets request: ${absolute}`);
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = await readFile(absolute);
      const mime = MIME_BY_EXT[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': data.byteLength.toString(),
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.warn(`[craft-asset] file not found: ${absolute}`);
        return new Response('Not found', { status: 404 });
      }
      console.error(`[craft-asset] read failed for ${absolute}:`, err);
      return new Response('Internal error', { status: 500 });
    }
  });

  const db = openDatabase(dbPath);
  runMigrations(db, resolveMigrationsFolder());

  // Start the local HTTP server so a phone/laptop on the same Wi-Fi can hit
  // the same data. Permissive CORS — trusted networks only.
  try {
    webServerInfo = await startWebServer(db, assetsRoot);
    console.log(`[web] listening on ${webServerInfo.urls.join(', ')}`);
  } catch (err) {
    console.error('[web] failed to start:', err);
  }

  // Create the window FIRST, then register IPC handlers, THEN load the URL.
  // If we attach handlers after loadURL the renderer can ngOnInit and call
  // procedures before the handlers exist — race condition fixed.
  const window = createBrowserWindow();
  const ipcHandler = attachIpcRouter(db, window);
  await loadRenderer(window);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createBrowserWindow();
      ipcHandler.attachWindow(w);
      await loadRenderer(w);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
