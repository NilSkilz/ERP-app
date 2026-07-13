import type { WebServerInfo } from './server.js';

// Where the running web server's ports/URLs live so the tRPC router can
// report them without importing the Electron main module (which would drag
// `electron` into the headless server bundle).
let info: WebServerInfo | null = null;

export function setWebServerInfo(next: WebServerInfo): void {
  info = next;
}

export function getWebServerInfo(): WebServerInfo | null {
  return info;
}
