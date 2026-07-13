// Wire format for the hand-rolled tRPC <-> IPC bridge.
// See DECISIONS.md for why we're not using `electron-trpc` here.
//
// Input and data are superjson-serialised payloads so Dates and other
// non-JSON-native types survive the round trip.

export const TRPC_IPC_CHANNEL = 'trpc:invoke';

export interface TrpcIpcRequest {
  path: string; // dotted procedure path, e.g. "components.purchase"
  type: 'query' | 'mutation';
  input: unknown; // superjson-serialised SuperJSONResult or undefined
}

export type TrpcIpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; code?: string } };

export interface BridgeApi {
  invoke(req: TrpcIpcRequest): Promise<TrpcIpcResponse>;
}
