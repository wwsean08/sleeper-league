import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['test/**/*.test.ts'], exclude: ['test/web/**'], environment: 'node' } },
      {
        test: {
          name: 'web',
          include: ['test/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['test/web/setup.ts'],
        },
      },
    ],
  },
});
