import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (name: string) => resolve(import.meta.dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@clinical-flow/expression': pkg('expression'),
      '@clinical-flow/fhir-lite': pkg('fhir-lite'),
      '@clinical-flow/workflow-core': pkg('workflow-core'),
      '@clinical-flow/workflow-engine': pkg('workflow-engine'),
    },
  },
  // Pathway JSON lives at the repo root so the engine, the CLI gate and the
  // studio all read exactly the same files.
  server: { port: 5173, fs: { allow: [resolve(import.meta.dirname, "../..")] } },
  build: { outDir: 'dist', sourcemap: true },
});
