import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * NestJS usa decoradores con `emitDecoratorMetadata`; esbuild (el
 * transformador por defecto de Vitest) no los emite. `unplugin-swc` toma la
 * configuración de `tsconfig.json` (experimentalDecorators +
 * emitDecoratorMetadata) y compila con SWC, que sí los soporta.
 */
const nestPlugins = () => [swc.vite(), tsconfigPaths()];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: nestPlugins(),
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          environment: 'node',
          setupFiles: ['./test/setup.ts'],
          testTimeout: 15_000,
          // Sin contenedores ni BD: puede correr en paralelo.
          pool: 'threads',
        },
      },
      {
        plugins: nestPlugins(),
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          environment: 'node',
          setupFiles: ['./test/setup.ts'],
          // Testcontainers + drizzle-kit push: arranque lento y un solo
          // contenedor compartido por archivo.
          testTimeout: 120_000,
          hookTimeout: 600_000,
          pool: 'forks',
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
