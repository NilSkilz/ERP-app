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
};

export function startWebServer(
  db: Db,
  assetsRoot: string,
  apiPort = 7273,
  rendererPort = 5173
): Promise<WebServerInfo> {
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

    // Asset files (variant attachments etc).
    if (url.startsWith('/assets/')) {
      return serveAsset(req, res, assetsRoot, url);
    }

    // Health probe — handy when debugging from the phone.
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, now: new Date().toISOString() }));
      return;
    }

    // For dev we don't serve the renderer here — Vite handles that on its own
    // host:port. In a packaged build we'd add static-file serving for the
    // electron-vite renderer output.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(apiPort, '0.0.0.0', () => {
      resolve({
        apiPort,
        rendererPort,
        urls: enumerateUrls(rendererPort),
      });
    });
  });
}

function setCors(res: ServerResponse): void {
  // Local-network use only; permissive CORS so the dev Vite renderer (on a
  // different port) can call the API. In production they share an origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-trpc-source');
}

async function serveAsset(
  req: IncomingMessage,
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
