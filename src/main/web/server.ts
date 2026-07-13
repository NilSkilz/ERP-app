import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import type { Db } from '../db/client.js';
import { createContext } from '../ipc/context.js';
import { appRouter } from '../ipc/router.js';

export interface WebServerInfo {
  apiPort: number;
  rendererPort: number;
  // URLs to type into Safari on the phone. Points at the renderer port, not
  // the API port — the API is what the renderer calls internally.
  urls: string[];
}

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
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface WebServerOptions {
  apiPort?: number;
  rendererPort?: number;
  // When set, the built renderer (electron-vite's out/renderer) is served
  // from the API port itself — the headless/LXC mode. When unset (Electron
  // dev), Vite serves the renderer on its own port and we only host the API.
  rendererDist?: string;
}

export function startWebServer(
  db: Db,
  assetsRoot: string,
  options: WebServerOptions = {}
): Promise<WebServerInfo> {
  const { apiPort = 7273, rendererPort = 5173, rendererDist } = options;
  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: () => createContext(db),
  });

  const server = http.createServer(async (req, res) => {
    setCors(res);
    console.log(`[web] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    // tRPC HTTP endpoint — strip the prefix and forward.
    if (url.startsWith('/api/trpc/')) {
      req.url = url.replace(/^\/api\/trpc/, '');
      return trpcHandler(req, res);
    }

    // Both the renderer's hashed bundles and variant attachments live under
    // /assets/ (renderer: /assets/index-<hash>.js, attachments:
    // /assets/variants/<id>/<file>). Prefer an exact renderer file, then
    // fall back to the attachment store.
    if (url.startsWith('/assets/')) {
      if (rendererDist && (await tryServeFile(res, rendererDist, url))) return;
      return serveAsset(req, res, assetsRoot, url);
    }

    // Health probe — handy when debugging from the phone.
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, now: new Date().toISOString() }));
      return;
    }

    // Headless mode: serve the built renderer from this same port. The app
    // uses a hash router, so anything that isn't a real static file gets the
    // SPA shell.
    if (rendererDist && req.method === 'GET') {
      if (await tryServeFile(res, rendererDist, url)) return;
      if (await tryServeFile(res, rendererDist, '/index.html')) return;
    }

    // Electron dev: Vite serves the renderer on its own host:port.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(apiPort, '0.0.0.0', () => {
      resolve({
        apiPort,
        rendererPort,
        urls: enumerateUrls(rendererDist ? apiPort : rendererPort),
      });
    });
  });
}

// Serve `url` as a static file under `root`. Returns false — with nothing
// written to the response — when the path escapes root or isn't a file, so
// the caller can try the next candidate.
async function tryServeFile(res: ServerResponse, root: string, url: string): Promise<boolean> {
  const pathname = decodeURIComponent(url.split('?')[0].split('#')[0]);
  const absolute = join(root, pathname.replace(/^\/+/, ''));
  const safePrefix = root + sep;
  if (!absolute.startsWith(safePrefix)) return false;
  const s = await stat(absolute).catch(() => null);
  if (!s || !s.isFile()) return false;
  try {
    const data = await readFile(absolute);
    const ext = extname(absolute).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Content-Length': data.byteLength.toString(),
      // Renderer bundles carry content hashes in their names so they can
      // cache; the HTML shell must always revalidate.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  } catch (err) {
    console.error(`[web] static read failed for ${absolute}:`, err);
    res.writeHead(500);
    res.end('Internal error');
  }
  return true;
}

function setCors(res: ServerResponse): void {
  // Local-network use only; permissive CORS so the dev Vite renderer (on a
  // different port) can call the API. In production they share an origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-trpc-source');
}

async function serveAsset(
  _req: IncomingMessage,
  res: ServerResponse,
  assetsRoot: string,
  url: string
): Promise<void> {
  const relative = decodeURIComponent(url.replace(/^\/assets\//, '').split('?')[0]);
  const absolute = join(assetsRoot, relative);
  const safePrefix = assetsRoot + sep;
  if (!absolute.startsWith(safePrefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const s = await stat(absolute);
    if (!s.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME_BY_EXT[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    const data = await readFile(absolute);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': data.byteLength.toString(),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    console.error(`[web] asset read failed for ${absolute}:`, err);
    res.writeHead(500);
    res.end('Internal error');
  }
}

function enumerateUrls(port: number): string[] {
  const urls: string[] = [`http://localhost:${port}`];
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        urls.push(`http://${addr.address}:${port}`);
      }
    }
  }
  return urls;
}
