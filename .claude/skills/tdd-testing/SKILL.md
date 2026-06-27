---
name: tdd-testing
description: >-
  Disciplina de Test-Driven Development (TDD) para el monorepo del juego (Meccha
  Chameleon Clone), apoyada en las otras skills: dominio puro y determinista,
  puertos/adaptadores con fakes en memoria, patrón Result, DI por constructor,
  simulación a 30 Hz idéntica en backend y frontend, y store vanilla de Zustand.
  Usa esta skill SIEMPRE que se vaya a escribir, modificar o revisar lógica de
  negocio (use-cases, entidades, value objects), netcode (predicción,
  reconciliación, ProcessTick), adaptadores (DO storage, KV, Hono), o lógica de
  cliente (worldStore, predicción en useGameSockets); y siempre que aparezcan las
  palabras "test", "TDD", "spec", "prueba", "vitest", "cobertura", "mock", "fake",
  "el test falla", o cuando se pida una nueva característica (porque en TDD el test
  va primero). Impone el ciclo rojo → verde → refactor, empezar por el interior del
  hexágono, fakes en vez de mocks, aserciones sobre Result (no try/catch), y tests
  de determinismo/replay. Aplícala ANTES de escribir el código de producción, no
  después.
---
 
# Testing con TDD (Meccha Chameleon Clone)
 
En este repo **el test va primero**. No es opcional ni "cuando haya tiempo": es la
forma en que se diseña el código. La arquitectura está hecha para que TDD sea
barato: el dominio es puro y determinista, los use-cases dependen de interfaces
(puertos) inyectadas, y devuelven `Result` en vez de lanzar. Eso significa que
puedes escribir un test que falle, en milisegundos, sin Cloudflare, sin sockets y
sin navegador, para casi toda la lógica que importa.
 
Esta skill se apoya en las otras cuatro y refuerza sus reglas mediante tests:
- `hexagonal-vertical-slicing` → fakes que implementan puertos, aserciones sobre
  `Result`, y DI por constructor que hace triviales los tests.
- `authoritative-netcode` → tests de determinismo, replay (golden) y paridad
  servidor-cliente.
- `workers-memory-optimization` → tests de corrección de los pools; las
  asignaciones se miden con benchmarks, no con asserts dentro del bucle.
- `r3f-rendering` → se testea el `worldStore` vanilla y la lógica fuera de React;
  nunca se testea `useFrame` por frame.
Lee este archivo entero antes de escribir el primer test o la primera línea de
producción de una característica.
 
## El ciclo: rojo → verde → refactor
 
1. **Rojo.** Escribe un test que exprese el comportamiento deseado y míralo fallar.
   Confirma que falla *por la razón correcta* (la aserción), no por un import roto.
   Un test que nunca lo viste fallar no prueba nada.
2. **Verde.** Escribe el **mínimo** código de producción para que pase. Nada de
   adelantar funcionalidad que ningún test pide todavía.
3. **Refactor.** Con el test como red de seguridad, limpia el diseño (nombres,
   duplicación, SOLID). Los tests siguen verdes o no es un refactor, es un cambio.
Repite en ciclos pequeños. Un commit sano es "un test nuevo + el código que lo hace
pasar + refactor". Si te encuentras escribiendo 40 líneas de producción antes de
correr un test, te saliste del ciclo.
 
## Por dónde empezar: de adentro hacia afuera
 
Empieza por el **interior del hexágono**, donde TDD rinde más y es más rápido:
 
1. **Value objects y entidades** (`domain/`) — invariantes puras. `Position`,
   `ColorRGBA`, reglas de `Player`/`Room`.
2. **Use-cases** (`use-cases/`) — una operación de negocio por test suite
   (`ChangeColor`, `PlayerJoin`, `ProcessTick`), con fakes inyectados.
3. **Adaptadores** (`infrastructure/`) — solo cuando el comportamiento depende de
   verdad del runtime (DO storage, alarms, rutas Hono). Tests de integración con
   `@cloudflare/vitest-pool-workers`.
4. **Cliente** (`features/`) — la lógica de `worldStore` y de predicción, fuera de
   React.
La mayoría de tus tests viven en los niveles 1 y 2 (rápidos, puros). Los niveles 3
y 4 son menos numerosos pero cubren las costuras con el mundo real.
 
## El bucle diario: use-cases con fakes y Result
 
Como los use-cases dependen de puertos por interfaz (DI) y devuelven `Result`, el
test es directo: construyes el use-case con un **fake** en memoria y afirmas sobre
el `Result`. Ejemplo TDD completo de `ChangeColor`:
 
**Rojo** — escribe primero el test del caso que aún no existe:
 
```ts
// gameplay/use-cases/ChangeColor.test.ts
import { describe, it, expect } from 'vitest';
import { ChangeColor } from './ChangeColor';
import { InMemoryRoomRepository } from '../../../test/fakes/InMemoryRoomRepository';
 
describe('ChangeColor', () => {
  it('rechaza con ColorLocked si el color está bloqueado en este tick', () => {
    const rooms = new InMemoryRoomRepository();
    rooms.seed(roomWithLockedPlayer('p1', { until: 50 }));
    const changeColor = new ChangeColor(rooms); // DI: misma firma que en prod
 
    const res = changeColor.execute({ playerId: 'p1', color: red, tick: 10 });
 
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('ColorLocked'); // sobre el discriminante
  });
});
```
 
**Verde** — el mínimo para pasar (ver `ChangeColor` en `hexagonal-vertical-slicing`):
devolver `Err({ kind: 'ColorLocked', until })` cuando corresponda.
 
**Refactor** — extrae la regla de bloqueo a un método de la entidad `Player` si se
repite, manteniendo el test verde.
 
Reglas de aserción en este repo:
- **Afirma sobre `Result`, no esperes excepciones** para errores de negocio. Nada
  de `expect(() => ...).toThrow()` para un `ColorLocked`: eso es un valor `Err`, no
  un throw.
- Usa helpers `expectOk(res)` / `expectErr(res, 'ColorLocked')` para que el test
  estreche el tipo y lea limpio (ver `references/tooling-setup.md`).
- Cubre **ambos caminos** de cada use-case: el `Ok` feliz y cada `kind` de error
  esperado. El `switch` exhaustivo del dominio te dice cuántos casos hay.
## Fakes, no mocks
 
Prefiere **fakes** (implementaciones reales en memoria de un puerto) sobre mocks
(dobles que verifican secuencias de llamadas). Un fake testea *comportamiento* y es
sustituible por el adaptador real (LSP); un mock acopla el test a *cómo* se llama,
y se rompe en cada refactor legítimo.
 
```ts
// test/fakes/InMemoryRoomRepository.ts — implementa el MISMO puerto que prod
export class InMemoryRoomRepository implements IRoomRepository {
  private rooms = new Map<string, Room>();
  seed(room: Room) { this.rooms.set(room.id, room); }
  async load(id: string) { return Ok(this.rooms.get(id) ?? null); }
  async save(id: string, room: Room) { this.rooms.set(id, room); return Ok(undefined); }
}
```
 
Que tu fake implemente `IRoomRepository` no es ceremonia: si la firma del puerto
cambia, el fake deja de compilar y te enteras de inmediato. Reserva `vi.fn()`/spies
para verificar *efectos de borde* puntuales (que se emitió un broadcast), no para
sustituir lógica de dominio.
 
## Tests de determinismo y replay (netcode)
 
El requisito de determinismo de `authoritative-netcode` se verifica con tests, y
son los más valiosos del proyecto:
 
**Replay / golden** — alimenta un stream de inputs grabado + una semilla y afirma
el estado exacto resultante. Mismo input + mismo estado ⇒ mismo mundo, siempre.
 
```ts
it('ProcessTick es determinista para un replay grabado', () => {
  const seed = 1234;
  const inputs = loadFixture('replays/match-001.json'); // comandos por tick
  const a = runReplay(inputs, seed);
  const b = runReplay(inputs, seed);
  expect(a).toEqual(b);                 // determinismo
  expect(a).toMatchSnapshot();          // golden: detecta cambios de reglas no intencionados
});
```
 
**Paridad servidor-cliente** — la simulación compartida debe producir un resultado
idéntico corriendo "como servidor" y "como cliente" (es lo que hace válida la
predicción). Corre el mismo stream por ambos caminos y compara.
 
```ts
it('cliente y servidor convergen al mismo estado con los mismos inputs', () => {
  const server = simulateAuthoritative(inputs, seed);
  const client = simulatePredicted(inputs, seed);   // mismo código de dominio
  expect(client.world).toEqual(server.world);
});
```
 
**Reconciliación** — test de regresión del bug clásico: dado un snapshot del
servidor que corrige una predicción, el cliente re-aplica los inputs pendientes y
**no** hace snap. Afirma que tras `onSnapshot` la posición resultante coincide con
re-simular los inputs no confirmados, no con la posición cruda del servidor.
 
Estos tests son puros (sin red): construyes los inputs, corres el dominio,
comparas. Por eso el dominio no debe importar transporte.
 
## Tests de adaptadores e integración (Cloudflare)
 
Cuando el comportamiento depende del runtime real (DO storage, alarms, hibernación,
rutas Hono), usa `@cloudflare/vitest-pool-workers`, que corre los tests dentro de
workerd (el mismo runtime que producción) con acceso a los bindings.
 
- **Durable Object** (`GameRoomDO`): usa `runInDurableObject()` para inspeccionar
  estado interno/storage, y `runDurableObjectAlarm()` para disparar una alarm sin
  esperar el temporizador.
- **Hono**: testea el handler con `exports.default.fetch()` (test de integración) o
  importando la app y llamando `app.request(...)` (unit, más rápido).
- **WebSockets en DO**: el aislamiento de storage por archivo no soporta WS; corre
  esos tests con storage compartido (`--max-workers=1 --no-isolate`).
- **Cobertura**: la pool no soporta cobertura nativa de V8; usa Istanbul.
Mantén estos tests pocos y enfocados a la costura (¿persiste el storage?, ¿se
re-hidrata tras hibernar?, ¿la ruta enruta al DO correcto?). La lógica de juego ya
está cubierta por los tests puros de use-cases. La config concreta está en
`references/tooling-setup.md`.
 
## Tests del frontend
 
Testea **fuera de React** todo lo que puedas:
- El **`worldStore`** vanilla de Zustand es un objeto normal: muta su estado y
  afirma. No necesita render.
- La **lógica de predicción/reconciliación** de `useGameSockets` (ring buffer de
  inputs, descarte por `seq`, re-aplicación) extráela a funciones puras y téstéalas
  como cualquier otra función.
- Para componentes de UI no-3D (`RoomForm`, `PlayerList`) usa React Testing Library
  con interacción y aserciones de accesibilidad.
**No** intentes testear `useFrame` ni la mutación de refs por frame: es justo el
camino que `r3f-rendering` saca de React a propósito, y meterlo en un test reintroduce
el acoplamiento que evitamos. Si necesitas verificar que la escena reacciona a un
cambio de estado lento, testea el store y, como mucho, usa
`@react-three/test-renderer` para una aserción puntual; nunca para animación.
 
## Qué NO testear con tests unitarios
 
- **Píxeles / "se ve bien"** → revisión visual o regresión por screenshot
  (Playwright), no un unit test.
- **FPS / frame time** → es un *benchmark*, no un assert; mídelo con la metodología
  de `workers-memory-optimization` (min/media/máx, tendencia del heap).
- **"No asigna en el bucle"** → no se afirma dentro del bucle caliente; se perfila.
  Lo que **sí** se testea es la *corrección del pool*: que `acquire`/`release`
  recicla y que `reset()` deja el objeto en estado limpio.
```ts
it('el pool recicla la misma instancia tras release', () => {
  const pool = new Pool<Bullet>(() => new Bullet(), b => b.reset(), 1);
  const a = pool.acquire(); pool.release(a);
  expect(pool.acquire()).toBe(a);     // misma referencia → sin asignar de nuevo
});
```
 
## Herramientas y layout
 
- **Vitest** en todo el monorepo (workspace por app/package).
- `domain/` y `use-cases/` → Vitest normal (node), sin runtime de Workers: son
  puros y rápidos.
- `infrastructure/` (DO, Hono, storage) → `@cloudflare/vitest-pool-workers`
  (workerd), requiere Vitest 4.1+ y apunta a tu `wrangler.json`.
- Fakes compartidos en `apps/backend/test/fakes/`; fixtures de replay en
  `test/replays/`.
- Comandos: `pnpm test` (todo), `pnpm test --watch` (modo TDD), `pnpm test:do`
  (pool de workers con `--max-workers=1 --no-isolate` para WS).
Config completa, plugin `cloudflareTest()`, helpers `expectOk`/`expectErr` y arnés
de replay: `references/tooling-setup.md`.
 
## Definition of done
 
Toda característica nueva nació de un test que primero falló; el dominio y los
use-cases tienen tests puros con fakes que cubren el `Ok` y cada `Err`; las
aserciones son sobre `Result`, no sobre throws de negocio; el netcode tiene tests
de determinismo, replay y paridad servidor-cliente; los adaptadores que dependen
del runtime tienen tests de integración acotados en workerd; la lógica de cliente
se testea fuera de React y no se testea `useFrame`; los pools tienen tests de
reciclaje; y el rendimiento se mide por benchmark, no por unit test.
 
## Referencia
 
- Cloudflare, *Testing Durable Objects* (`runInDurableObject`,
  `runDurableObjectAlarm`):
  https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
- Cloudflare, *Vitest integration* (write your first test, config, known issues):
  https://developers.cloudflare.com/workers/testing/vitest-integration/
- Hono, *Cloudflare Testing* con vitest-pool-workers:
  https://hono.dev/examples/cloudflare-vitest
- Config, plugin y helpers de este repo: `references/tooling-setup.md`