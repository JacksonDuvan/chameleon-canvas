# 02 · Paso 2 — Dominio del backend (netcode-first)

> Registro de lo construido en el **Paso 2**. Estado: **completado y verificado** en
> Node 24.11 — **68/68 tests en verde** + `tsc --noEmit` limpio + `pnpm lint` limpio
> (ver §6). Retoma desde aquí en otra sesión.

## 1. Objetivo

Desarrollar el **dominio del backend** (entidades de Sala, Jugador, Estado del juego,
transición de fases) **libre de infraestructura**, con estrategia **netcode-first**:
un MVP abstracto en coordenadas `(x, y, z)` donde dos entidades pueden **moverse,
disparar y registrar impactos matemáticos**; servidor autoritativo con físicas
ligeras, estructurado para una futura integración determinista de Rapier. Todo con
**TDD** (tests primero).

## 2. Qué se construyó

### Kernel compartido determinista — `packages/sim/src/`
Es el código que **servidor y cliente ejecutan idéntico** (habilita la predicción).

| Archivo | Rol |
|---|---|
| `core/value-objects/Vec3.ts` | vector 3D mutable, monomórfico, con math `*Mut` (sin asignar) + `normalizeMut` |
| `core/value-objects/Position.ts` | alias semántico de `Vec3` (misma clase ⇒ una sola hidden class) |
| `core/value-objects/ColorRGBA.ts` | color del cuentagotas + `packRGBA8`/`fromPacked` (cuantización wire) |
| `core/rng.ts` | RNG determinista mulberry32, **estado serializable** (`get/setState`) |
| `core/collision.ts` | `raySphere` (impacto del disparo) + `clampToBoundsMut` (anti-trampas) |
| `core/config.ts` | `SimConfig` determinista (tick 30 Hz, maxSpeed, catchRange, duraciones, bounds) |
| `core/entities/PlayerState.ts` | estado cinemático predicho (pos, vel, aim, color, role, frozen, caught, `lastProcessedInput`) |
| `core/entities/WorldState.ts` | tick, phase, `phaseEndsAtTick`, outcome, `seed`, `rngState`, players, config |
| `core/phases.ts` | `spawnPlayer`, `startGame` (roles deterministas), `advancePhaseIfDue`, `anyHiderAlive` |
| `core/step.ts` | **el tick determinista**: inputs → movimiento (clamp) → captura (raycast) → fase |
| `physics/IPhysicsWorld.ts` | puerto de consulta espacial (raycast) — el núcleo depende de esto, no de Rapier |
| `physics/KinematicPhysicsWorld.ts` | adaptador ligero puro-TS (cuerpos pre-asignados, raycast determinista) |

### Slice gameplay del backend — `apps/backend/src/slices/gameplay/`
Lo **server-only** (no se predice): orquesta el kernel vía use-cases.

| Capa | Archivos |
|---|---|
| `domain/entities/` | `Room` (agregado: id, host, config, `world`, roster), `Player` (sesión: nombre, host, premium), `GameMap` |
| `domain/ports/` | `IRoomRepository` |
| `domain/errors.ts` | uniones discriminadas: `ProcessTickError`, `PlayerJoinError`, `ChangeColorError`, `StartGameError`, `StorageError` |
| `use-cases/` | `ProcessTick`, `PlayerJoin`, `ChangeColor`, `StartGame` — devuelven `Result`, DI por constructor |
| `infrastructure/adapters/` | `DoStorageRoomRepository` (serializa Room↔snapshot plano; el structured-clone del DO no conserva prototipos) |

### Tests (TDD) — 12 suites
Kernel (puro, Vitest node): `Vec3`, `ColorRGBA`, `rng`, `collision`, `phases`, `step`,
`KinematicPhysicsWorld`, **`replay`** (determinismo + golden). Use-cases (con fakes
`InMemoryRoomRepository`/`FakeMonetization` + helpers `expectOk/expectErr`):
`PlayerJoin`, `ChangeColor`, `StartGame`, `ProcessTick`.

## 3. Comportamiento del MVP (reglas implementadas)

- **Movimiento** por fase: Lobby nadie; Prep solo Hiders (Seekers esperan a ciegas);
  Hunt solo Seekers (Hiders congelados). Velocidad clampeada a `maxSpeed` y posición
  clampeada a los límites del escenario (anti-trampas).
- **Disparo/Captura**: el Seeker lanza un rayo hacia adelante (`raycastClosest` por el
  puerto); si impacta a un Hider en `catchRange`, ese Hider **pasa a Seeker** (caught).
- **Fases**: `Lobby → Prep → Hunt → Ended` por umbral de tick (deterministas, el
  cliente las predice). **Victoria**: al acabar Hunt, ganan los Hiders si sobrevive
  ≥1, si no los Seekers.
- **Camuflaje** (`ChangeColor`): solo en Prep; el servidor valida fase + bloqueo
  anti-spam y aplica el color que el cliente sampleó del entorno.

## 4. Garantías de determinismo y anti-trampas

- `step` avanza por `dt` **fijo** inyectado; **sin** `Date.now`/`Math.random`/reloj.
- **RNG con semilla** mulberry32; su estado (`world.rngState`) se **enhebra** entre
  ticks (ProcessTick) y se persiste — listo para consumo futuro sin romper determinismo.
- **Sin trigonometría** en la sim: el apunte viaja como dirección (`aimX/aimZ`); `yaw`
  se deriva en el cliente.
- **Raycast determinista**: `syncBodies` ordena los cuerpos por id y el empate de
  distancia lo gana el id menor (`<` estricto) — mismo resultado en cliente y servidor
  sin importar el orden de llegada de los joins.
- **Servidor autoritativo**: el input es solo intención; el servidor **re-normaliza el
  apunte** del cliente (no confía en él), clampa velocidad y posición.

## 5. Verificación (workflow adversarial)

Como el entorno no permite ejecutar Vitest (Node 20 + `engine-strict`), se escribieron
los tests primero (TDD) y se verificó el código con un **workflow de 5 lentes en
paralelo + síntesis** (determinismo, pureza hexagonal, memoria, matemáticas,
tests/compilación). Resultado y acciones:

**Must-fix encontrados y corregidos:**
1. *No-determinismo en `raycastClosest`*: el empate dependía del orden de iteración del
   `Map`. → `syncBodies` ahora ordena por id (comparación por unidad de código) + `<`
   estricto. Test de regresión: `KinematicPhysicsWorld.test.ts` (orden inverso ⇒ misma
   víctima).
2. *Apunte sin normalizar*: `raySphere` asume dirección unitaria; el cliente podía
   enviar `aim` no normalizado. → el servidor normaliza en `step` (`Vec3.normalizeMut`).
   Test de regresión: captura con diagonal sin normalizar en `step.test.ts`.

**Mejoras aplicadas:** `rngState` persistido en `WorldState` y enhebrado por
`ProcessTick`/`StartGame` (elimina fragilidad + asignación por-tick); guard runtime en
`KvMonetizationAdapter` (no confiar en el cast en la frontera I/O); tests reusan un
único `Rng` (reflejan la intención de estado compartido).

**Falsos positivos descartados (verificados):** el supuesto "blocker" de compilación
`this.ids[i] === excludePlayerId` — comparar `string | undefined === string` es **legal**
en TS, no rompe el build. La "reentrancia" del scratch `_dir` — `step` es 100% síncrono,
el event loop no puede intercalarlo.

## 6. Cómo ejecutar los tests (entorno del usuario, Node 24)

```bash
nvm use            # Node 24 (.nvmrc)
pnpm install
pnpm --filter @mecha/sim test        # kernel puro (incluye replay/determinismo + golden)
pnpm --filter @mecha/backend test     # use-cases con fakes
# o todo: pnpm test
```
El golden de `replay.test.ts` se crea en la primera ejecución (revisar y versionar).

**Resultado (ejecutado en Node 24.11.0):** ✅ **68/68 tests** (51 en `@mecha/sim`, 17 en
`@mecha/backend`), `tsc --noEmit` limpio en shared/sim/backend, y `pnpm lint` limpio.
El golden de `replay.test.ts` ya se generó (`__snapshots__/`, versionado). Ajustes
hechos al ejecutar: corregida una expectativa de test (el spawn es una rejilla, no el
origen), sincronizado el stub `RapierPhysicsWorld` con el puerto evolucionado, y
declaradas las deps de ESLint que faltaban (`@eslint/js`, `typescript-eslint`) +
`argsIgnorePattern: '^_'` para alinear lint con la convención `_` de tsc.

## 7. Pendientes / cara al Paso 3

- **Versiones a ajustar (descubierto en `pnpm install`):**
  `@cloudflare/vitest-pool-workers ^0.6` resolvió a `0.6.16`, cuyo peer es Vitest 2.x
  (tenemos 4.1.9) — subir a la línea compatible con Vitest 4 antes de escribir los tests
  de DO del Paso 3. `@tanstack/react-start 1.168` exige **Vite >= 7** (tenemos 6) —
  subir `vite` a `^7` (y revisar `@cloudflare/vite-plugin`) en el Paso 4. Ninguno afecta
  los tests del Paso 2 (kernel + use-cases corren en Vitest node).
- **Paso 3 (DO + sockets Hono):** bucle a 30 Hz dentro de `GameRoomDO`, WebSocket
  Hibernation API, **encode/decode binario** (delta + keyframes, cuantización) según
  `@shared/protocol` (`wire.ts`), broadcast de snapshots con `lastProcessedInput`,
  enrutado del upgrade desde el Worker, y tests de integración con `vitest-pool-workers`.
- **Hono RPC (cara al Paso 4):** al consumir `AppType` en el frontend, aislar su grafo
  de tipos de los tipos de runtime de Workers (`cloudflare:workers`/`@cloudflare/workers-types`)
  para que el typecheck del frontend no necesite esos tipos.
- **Rapier real:** cuando haga falta colisión contra geometría compleja, sustituir
  `KinematicPhysicsWorld` por `RapierPhysicsWorld` (mismo puerto; `initRapier` en
  `blockConcurrencyWhile`).
- **Migrar replay harness** a `apps/backend/test/helpers/replay.ts` + fixtures en
  `test/replays/` cuando se graben partidas reales (hoy el golden vive en el kernel).
