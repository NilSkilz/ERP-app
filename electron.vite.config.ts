import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      angular({
        tsconfig: resolve(__dirname, 'tsconfig.web.json'),
      }),
    ],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/app'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    server: {
      // Bind Vite to all interfaces so a phone on the same Wi-Fi can load the
      // renderer at http://<mac-ip>:<vite-port>/ during dev.
      host: true,
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
