import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@clinical-flow/expression': pkg('expression'),
      '@clinical-flow/fhir-lite': pkg('fhir-lite'),
      '@clinical-flow/workflow-core': pkg('workflow-core'),
      '@clinical-flow/workflow-engine': pkg('workflow-engine'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/index.ts', 'packages/fhir-lite/src/patients.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
