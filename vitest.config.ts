import { defineConfig } from 'vitest/config';
import * as path from 'path';

// Paid evals run only with RUN_EVALS=1; their server starts via global setup.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: process.env.RUN_EVALS === '1' ? ['**/*.test.ts'] : ['app/**/*.test.ts', 'lib/agents/**/*.test.ts'],
    exclude: ['node_modules', '.next', ...(process.env.RUN_EVALS === '1' ? [] : ['lib/evals/**'])],
    fileParallelism: false, // parallel files + shared server/DB made the evals time out
    reporters: ['verbose'], // every test + its time, and console output
    setupFiles: process.env.RUN_EVALS === '1' ? ['dotenv/config'] : [],
    globalSetup: process.env.RUN_EVALS === '1' ? ['./vitest.global-setup.ts'] : [],
  },
});
