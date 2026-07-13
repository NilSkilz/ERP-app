import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/main/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: true,
  },
});
