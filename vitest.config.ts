import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['ai','agent','telemetry'].map((p) => [
    `@earendil-works/${p === 'agent' ? 'pi-agent-core' : `pi-${p}`}`,
    resolve(`pi/packages/${p}/src/index.ts`),
  ])) },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
});
