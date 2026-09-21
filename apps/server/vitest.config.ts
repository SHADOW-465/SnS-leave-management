import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    // ponytail: each file boots a database (PGlite is heavy); more forks exhausted memory
    maxWorkers: 2,
    minWorkers: 1,
  },
});
