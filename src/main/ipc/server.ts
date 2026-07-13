import { ipcMain, type BrowserWindow } from 'electron';
import superjson from 'superjson';
import type { Db } from '../db/client.js';
import { TRPC_IPC_CHANNEL, type TrpcIpcRequest, type TrpcIpcResponse } from '../../shared/ipc-protocol.js';
import { createContext } from './context.js';
import { appRouter } from './router.js';

export interface IpcHandle {
  // Kept for API symmetry — ipcMain is global so windows attach implicitly.
  attachWindow(window: BrowserWindow): void;
}

export function attachIpcRouter(db: Db, _window: BrowserWindow): IpcHandle {
  // Re-attaching during HMR would throw without removing the previous handler.
  ipcMain.removeHandler(TRPC_IPC_CHANNEL);

  ipcMain.handle(TRPC_IPC_CHANNEL, async (_event, raw: TrpcIpcRequest): Promise<TrpcIpcResponse> => {
    try {
      if (raw.type !== 'query' && raw.type !== 'mutation') {
        throw new Error(`Unsupported op type: ${raw.type}`);
      }
      const caller = appRouter.createCaller(createContext(db));
      const fn = walkPath(caller, raw.path);
      const input = raw.input === undefined ? undefined : superjson.deserialize(raw.input as never);
      const result = await fn(input);
      const data = result === undefined ? undefined : superjson.serialize(result);
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code;
      console.error(`[ipc] ${raw?.path} failed:`, err);
      return { ok: false, error: { message, code } };
    }
  });

  return {
    attachWindow: () => {
      /* no-op */
    },
  };
}

function walkPath(root: unknown, dotted: string): (...args: unknown[]) => Promise<unknown> {
  const fn = dotted
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], root);
  if (typeof fn !== 'function') {
    throw new Error(`Unknown procedure: ${dotted}`);
  }
  return fn as (...args: unknown[]) => Promise<unknown>;
}
