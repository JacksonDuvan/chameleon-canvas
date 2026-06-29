// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * ESLint flat config (ESLint 9) para el monorepo.
 *
 * Refuerza, EN TIEMPO DE LINT, la regla de oro de la skill
 * `hexagonal-vertical-slicing`: "las dependencias apuntan hacia adentro". Un
 * import en dirección equivocada debe romper el lint (idealmente el CI), no solo
 * quedar a criterio del revisor.
 *
 * Dos capas de defensa:
 *  1) `boundaries/element-types`: nadie de afuera entra al núcleo y el núcleo no
 *     sale hacia adaptadores/UI.
 *  2) `no-restricted-imports` sobre las capas PURAS (domain + sim/core): prohíbe
 *     importar frameworks/transporte/render (hono, three, @cloudflare/*, react…).
 *
 * NOTA (Paso 1): la mecánica de `eslint-plugin-boundaries` es sensible a que los
 * `pattern` coincidan exactamente con el layout real. Validar con `pnpm lint`
 * cuando existan archivos; afinar patterns si algún elemento queda sin clasificar.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.wrangler/**',
      '**/.tanstack/**',
      '**/node_modules/**',
      '**/*.gen.ts',
      '**/worker-configuration.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Convención del repo: el prefijo `_` marca params/vars intencionalmente sin usar
  // (alinea con noUnusedLocals/noUnusedParameters de tsc, que ya ignoran `_`).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ── Clasificación de elementos arquitectónicos ──
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*', 'apps/**/*'],
      'boundaries/elements': [
        // Contratos de red compartidos (lo más interno y neutral).
        { type: 'shared', pattern: 'packages/shared/src/**' },
        // Kernel de simulación determinista: núcleo puro vs adaptador de físicas.
        { type: 'sim-core', pattern: 'packages/sim/src/core/**' },
        { type: 'sim-physics', pattern: 'packages/sim/src/physics/**' },
        // Capas de cada slice del backend (hexágono por slice).
        { type: 'domain', pattern: 'apps/backend/src/slices/*/domain/**' },
        { type: 'use-cases', pattern: 'apps/backend/src/slices/*/use-cases/**' },
        {
          type: 'infrastructure',
          pattern: 'apps/backend/src/slices/*/infrastructure/**',
        },
        { type: 'backend-shared', pattern: 'apps/backend/src/shared/**' },
        // Frontend feature-based.
        { type: 'feature', pattern: 'apps/frontend/src/features/**' },
        { type: 'frontend-shared', pattern: 'apps/frontend/src/shared/**' },
        { type: 'routes', pattern: 'apps/frontend/src/routes/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            // El dominio del backend NO puede importar hacia afuera del hexágono.
            {
              from: ['domain'],
              disallow: ['use-cases', 'infrastructure', 'feature', 'routes'],
              message:
                'Violación hexagonal: el dominio no puede depender de use-cases/infraestructura/UI. Las flechas apuntan hacia adentro.',
            },
            // El núcleo puro de la simulación no depende del adaptador de físicas.
            {
              from: ['sim-core'],
              disallow: ['sim-physics', 'infrastructure', 'feature'],
              message:
                'El núcleo puro de simulación no puede importar el adaptador de Rapier ni infraestructura; usa el puerto IPhysicsWorld.',
            },
            // Los use-cases orquestan dominio + puertos, no tocan entrypoints/UI.
            {
              from: ['use-cases'],
              disallow: ['feature', 'routes'],
              message: 'Un use-case no puede depender del frontend.',
            },
          ],
        },
      ],
    },
  },

  // ── Capas PURAS: prohibido importar frameworks/transporte/render ──
  {
    files: [
      'apps/backend/src/slices/*/domain/**/*.ts',
      'packages/sim/src/core/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'hono', message: 'El dominio es puro: usa un puerto/adaptador.' },
            { name: 'three', message: 'El dominio no conoce el render (Three.js).' },
            { name: 'react', message: 'El dominio no conoce React.' },
            {
              name: '@dimforge/rapier3d-compat',
              message:
                'El dominio puro no importa Rapier directo: depende del puerto IPhysicsWorld (sim/physics es el adaptador).',
            },
          ],
          patterns: [
            {
              group: ['@cloudflare/*', 'cloudflare:*', '@tanstack/*'],
              message:
                'El dominio/núcleo no puede importar infraestructura de Cloudflare ni TanStack.',
            },
          ],
        },
      ],
    },
  },

  // Tests: relaja reglas estrictas de "no usados" para fixtures.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
