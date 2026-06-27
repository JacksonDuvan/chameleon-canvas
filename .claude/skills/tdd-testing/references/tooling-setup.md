# Config de testing, helpers y arnés de replay
 
Lee esto al montar Vitest en el monorepo o al escribir helpers de test. Las reglas
de TDD están en el `SKILL.md`; aquí está la mecánica concreta.
 
## Dos entornos de test
 
El dominio y los use-cases son puros: córrelos con Vitest normal (Node), que es lo
más rápido. La infraestructura (Durable Objects, Hono, storage, alarms) necesita el
runtime real: córrela con `@cloudflare/vitest-pool-workers` (workerd).
 
```
apps/backend/
├── vitest.config.ts            # Vitest normal: domain/ y use-cases/
├── vitest.workers.config.ts    # pool-workers: infrastructure/
└── test/
    ├── fakes/                  # InMemoryRoomRepository, FakeMonetization, ...
    ├── helpers/                # expectOk / expectErr / runReplay
    └── replays/                # fixtures *.json de inputs por tick
```
 
## Vitest puro (dominio / use-cases)
 
```ts
// apps/backend/vitest.config.ts
import { defineConfig } from 'vitest/config';
 
export default defineConfig({
  test: {
    include: ['src/slices/**/{domain,use-cases}/**/*.test.ts'],
    environment: 'node',
  },
});
```
 
## Vitest pool-workers (infraestructura: DO, Hono, KV)
 
Requiere Vitest 4.1+ y `@cloudflare/vitest-pool-workers` como dev deps. Apunta a tu
`wrangler.json` para heredar bindings y migraciones.
 
```ts
// apps/backend/vitest.workers.config.ts
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
 
export default defineWorkersProject({
  test: {
    include: ['src/slices/**/infrastructure/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.json' },
      },
    },
  },
});
```
 
```jsonc
// test/tsconfig.json — tipos del runtime y de cloudflare:test
{
  "compilerOptions": {
    "types": [
      "@cloudflare/vitest-pool-workers/types",
      "./worker-configuration.d.ts" // salida de `wrangler types`
    ]
  },
  "include": ["**/*.ts", "../src"]
}
```
 
Caveats relevantes (de la doc oficial):
- **WebSockets en DO** no funcionan con aislamiento de storage por archivo. Corre
  esos tests con storage compartido: `vitest --max-workers=1 --no-isolate`.
- **Cobertura**: la nativa de V8 no está soportada en la pool; usa Istanbul.
- En tests de integración, **importa y llama tus handlers directamente** (los
  `import()` dinámicos no funcionan dentro de `export default { ... }` ni en los
  handlers del DO).
- `await` siempre las promesas de storage antes de afirmar.
## Helpers de aserción para Result
 
Estrechan el tipo y hacen el test legible. No esperes throws para errores de
negocio.
 
```ts
// test/helpers/result.ts
import { expect } from 'vitest';
import type { Result } from '@shared/result';
 
export function expectOk<T, E>(r: Result<T, E>): T {
  expect(r.ok, `se esperaba Ok pero fue Err: ${JSON.stringify(!r.ok && r.error)}`).toBe(true);
  if (!r.ok) throw new Error('inalcanzable'); // narrowing
  return r.value;
}
 
export function expectErr<T, E extends { kind: string }>(r: Result<T, E>, kind: E['kind']): E {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('inalcanzable');
  expect(r.error.kind).toBe(kind);
  return r.error;
}
```
 
Uso:
 
```ts
const room = expectOk(changeColor.execute(validCmd));
expect(room.players.get('p1')!.color).toEqual(red);
 
const err = expectErr(changeColor.execute(lockedCmd), 'ColorLocked');
expect(err.until).toBe(50);
```
 
## Arnés de replay (determinismo / golden)
 
```ts
// test/helpers/replay.ts
import { step } from '@/slices/gameplay/use-cases/ProcessTick';
import { makeRng } from '@/slices/gameplay/domain/rng';
import { initialWorld } from '@/slices/gameplay/domain/world';
 
export interface RecordedTick { tick: number; commands: UserCommand[]; }
 
export function runReplay(ticks: RecordedTick[], seed: number): World {
  let world = initialWorld();
  const rng = makeRng(seed);          // RNG con semilla: determinismo
  const dt = 1 / 30;                  // tick fijo a 30 Hz
  for (const t of ticks) {
    world = step(world, t.commands, dt, rng);
  }
  return world;
}
```
 
Con esto, los tests de `authoritative-netcode` quedan triviales:
 
```ts
const a = runReplay(inputs, 1234);
const b = runReplay(inputs, 1234);
expect(a).toEqual(b);          // mismo input + semilla ⇒ mismo mundo
expect(a).toMatchSnapshot();   // golden: avisa si cambian las reglas
```
 
## Tests de Durable Object (ejemplo)
 
```ts
// GameRoomDO.test.ts (pool-workers)
import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
 
it('persiste el marcador y se re-hidrata tras un wake', async () => {
  const id = env.GAME_ROOM.idFromName('sala-1');
  const stub = env.GAME_ROOM.get(id);
 
  await runInDurableObject(stub, async (instance, state) => {
    await instance.setScore('p1', 3);
    expect(await state.storage.get('score:p1')).toBe(3);
  });
});
```
 
## Convención de nombres y comandos
 
- Archivos: `Algo.test.ts` junto al código que prueban dentro del slice/feature.
- Fixtures de replay versionados en `test/replays/` (no los regeneres a la ligera:
  un golden que cambia debe ser una decisión consciente).
- `pnpm test` (todo) · `pnpm test --watch` (TDD) · `pnpm test:do`
  (`vitest -c vitest.workers.config.ts --max-workers=1 --no-isolate`).