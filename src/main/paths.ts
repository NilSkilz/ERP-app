import { join } from 'node:path';

// Data directory for the DB and attachment assets. Set exactly once by the
// process entry point (Electron main or the headless web server) before
// anything touches the filesystem. Keeping this here — instead of calling
// Electron's app.getPath() at use sites — is what lets the domain layer run
// without Electron installed.
let dataDir: string | null = null;

export function setDataDir(dir: string): void {
  dataDir = dir;
}

export function getDataDir(): string {
  if (!dataDir) {
    throw new Error('setDataDir() must be called by the entry point before data paths are used');
  }
  return dataDir;
}

export function dbPath(): string {
  return join(getDataDir(), 'craft.db');
}

export function assetsDir(): string {
  return join(getDataDir(), 'assets');
}
