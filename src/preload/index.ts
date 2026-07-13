import { contextBridge, ipcRenderer } from 'electron';
import { TRPC_IPC_CHANNEL, type TrpcIpcRequest, type TrpcIpcResponse } from '../shared/ipc-protocol.js';

const bridge = {
  invoke(req: TrpcIpcRequest): Promise<TrpcIpcResponse> {
    return ipcRenderer.invoke(TRPC_IPC_CHANNEL, req);
  },
};

contextBridge.exposeInMainWorld('erpTrpc', bridge);
