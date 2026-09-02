import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // This app intentionally starts client-only hydration and authenticated
      // data loads from effects. These state changes are asynchronous UI setup,
      // not derived state that belongs in render.
      'react-hooks/set-state-in-effect': 'off',
      // Checkout telemetry timestamps an interaction trail at component start.
      'react-hooks/purity': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.open-next/**',
    '.wrangler/**',
    'next-env.d.ts',
    'cloudflare-env.d.ts',
  ]),
]);
