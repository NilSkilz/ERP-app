import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

// Builds the headless server entry (src/server/index.ts) into a single
// self-contained ESM bundle at out/server/index.js. Everything is bundled
// except better-sqlite3 (native addon — installed on the target machine).
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(root, 'src/main'),
      '@shared': resolve(root, 'src/shared'),
    },
  },
  ssr: {
    noExternal: true,
    external: ['better-sqlite3'],
  },
  build: {
    ssr: resolve(root, 'src/server/index.ts'),
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
});
