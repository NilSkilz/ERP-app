import { createTRPCProxyClient, httpBatchLink, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';
import type { AppRouter } from '../../../main/ipc/router';
import type { BridgeApi } from '../../../shared/ipc-protocol';

declare global {
  interface Window {
    erpTrpc?: BridgeApi;
  }
}

// True when running inside the Electron renderer (preload exposed the bridge).
// False when the same code is loaded over HTTP by a phone or laptop on the
// LAN — in that case we go via the HTTP API on port 7273.
export const isElectron = typeof window !== 'undefined' && !!window.erpTrpc;

// IPC link — talks to the preload bridge inside Electron.
const ipcLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    observable((observer) => {
      if (op.type === 'subscription') {
        observer.error(
          TRPCClientError.from(new Error('Subscriptions are not supported on this transport'))
        );
        return () => {};
      }
      const input = op.input === undefined ? undefined : superjson.serialize(op.input);
      window.erpTrpc!
        .invoke({ path: op.path, type: op.type, input })
        .then((res) => {
          if (res.ok) {
            const data = res.data === undefined ? undefined : superjson.deserialize(res.data as never);
            observer.next({ result: { data } });
            observer.complete();
          } else {
            observer.error(TRPCClientError.from(new Error(res.error.message)));
          }
        })
        .catch((err: unknown) => {
          observer.error(
            TRPCClientError.from(err instanceof Error ? err : new Error(String(err)))
          );
        });
      return () => {};
    });
};

// HTTP link — for browsers. Same-origin when the page is served by the app's
// own web server (headless hosting, possibly behind a reverse proxy /
// subdomain, where the port is NOT 7273 from the browser's point of view).
// Only the Vite dev server needs the cross-port hop to the API on 7273.
function apiBaseUrl(): string {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return 'http://localhost:7273';
  }
  const { protocol, hostname, port, host } = window.location;
  if (port === '5173') return `http://${hostname}:7273`; // electron-vite dev
  return `${protocol}//${host}`;
}

function httpApiUrl(): string {
  return `${apiBaseUrl()}/api/trpc`;
}

export const trpc = createTRPCProxyClient<AppRouter>({
  // tRPC v10 reads the transformer at the client level; built-in links like
  // httpBatchLink pick it up automatically. The custom ipcLink does its own
  // superjson handling and ignores this — no conflict.
  transformer: superjson,
  links: [
    isElectron
      ? ipcLink
      : httpBatchLink({
          url: httpApiUrl(),
        }),
  ],
});

// Convenience helper for building asset URLs that work in both modes:
//   electron : craft-asset:///<storage_path>
//   browser  : <api base>/assets/<storage_path>
export function assetUrl(storagePath: string): string {
  if (isElectron) return `craft-asset:///${storagePath}`;
  return `${apiBaseUrl()}/assets/${storagePath}`;
}

export type TrpcClient = typeof trpc;
