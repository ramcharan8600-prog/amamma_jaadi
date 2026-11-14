import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The suite checks the OPEN shop — the one we reopen with — so it runs with
    // the closed-shop switch off. The closed state has its own tests, which turn
    // it back on (see src/lib/shop-closed.test.ts and SHOP_CLOSED in constants).
    env: { SHOP_CLOSED: 'off' },
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
