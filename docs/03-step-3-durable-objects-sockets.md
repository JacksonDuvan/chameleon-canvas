# 03 · Paso 3 — Durable Objects + sockets Hono (adaptadores de entrada)

> Registro de lo construido en el **Paso 3**. Estado: **completado y verificado** en
> Node 24.11 — **80 tests en verde** (incl. 4 de integración del DO en workerd) +
> typecheck + lint limpios. Retoma desde aquí en otra sesión.

## 1. Objetivo

Implementar los **adaptadores de entrada** (driving) del backend: el **Durable
Object** `GameRoomDO` y los **sockets** como puerta del mundo exterior al núcleo, con
el **bucle de juego a 30 Hz** y la **transmisión del estado por WebSockets** en
formato binario compacto, protegiendo los límites de CPU de los Workers (Tick Rate
20–30 Hz, fijado a 30).

## 2. Qué se construyó

### Formato de red binario — `packages/shared/src/protocol/wire.ts`
El corazón de la transmisión. Pure, pooleado, fully tested (node).
- `ByteWriter`/`ByteReader` sobre `ArrayBuffer` reutilizado (cursor; cero asignaciones).
- **Cuantización**: posiciones a punto fijo `int16` (cm), movimiento/apunte a `int16`
  (×1000), color a `uint32`, rol+flags en un bitfield byte.
- **INPUT** (cliente→servidor) `encodeInput`/`decodeInput`: `seq` + intención de
  movimiento + apunte + acción. SIN `playerId` (lo adjunta el servidor desde la
  conexión → anti-spoofing).
- **KEYFRAME** (estado completo) y **DELTA** (solo jugadores cuya firma cuantizada
  cambió vs una `Baseline`) + `captureBaseline` + `decodeSnapshot`. Cada jugador lleva
  su `lastProcessedInput` (reconciliación) ⇒ una sola codificación sirve a todos.
- **Sin ciclo de dependencias**: vive en `@shared` y NO importa `@mecha/sim`; opera
  sobre interfaces ESTRUCTURALES (`WireWorld`/`WirePlayer`) que `WorldState`/`PlayerState`
  satisfacen por duck-typing (el servidor pasa el mundo directo al encoder, sin DTOs).
- **Familias de frame**: binario = INPUT/SNAPSHOT (camino caliente); string JSON =
  control raro (JOIN vía query, START, CHANGE_COLOR, CHAT).

### Durable Object — `…/infrastructure/entrypoints/GameRoomDO.ts`
Adaptador driving central + composition root. Una instancia = una sala.
- **Hibernation API**: `acceptWebSocket` (no `accept()`), handlers `webSocketMessage`/
  `Close`/`Error`, `serializeAttachment({playerId})`, `setWebSocketAutoResponse('ping'/'pong')`.
- **Join** por handshake en el upgrade: lee `?name=`, genera `playerId` server-side
  (`crypto.randomUUID().slice(0,8)`), corre el use-case `PlayerJoin`, responde `welcome`.
- **Bucle a 30 Hz** (`setInterval`): drena `inbox` → `step()` **directo y síncrono**
  (sin I/O, RNG enhebrado vía `world.rngState`) → broadcast → persistencia periódica.
- **Broadcast**: KEYFRAME a recién unidos / roster cambiado (`forceKeyframe`) / cada
  ~1 s; DELTA en el resto. Una codificación, enviada a todos.
- **Persistencia**: el bucle NO toca storage por tick; persiste a DO storage cada ~2 s
  y al vaciarse la sala (`DoStorageRoomRepository`).
- **Lifecycle**: el bucle arranca al primer join y se detiene al quedar vacía (la sala
  queda elegible para hibernar).

### Adaptadores
- **`SingleRoomRepository`** (in-memory, producción): mantiene la ÚNICA sala viva del
  DO; los use-cases (PlayerJoin/StartGame/ChangeColor) operan sobre ella sin tocar
  storage por llamada. El DO persiste aparte vía `DoStorageRoomRepository`.

### Tests — 80 totales (+9 vs Paso 2)
- `wire.test.ts` (node, 5): round-trips de INPUT/KEYFRAME/DELTA, cuantización, delta
  por cambio de firma.
- `SingleRoomRepository.test.ts` (node, 3).
- `GameRoomDO.test.ts` (**workerd / pool-workers, 4**): rechazo de no-upgrade (426),
  upgrade+join (101), WELCOME con playerId, persistencia de roomId (costura de storage).

## 3. Decisiones de arquitectura

- **Sala viva en memoria + persistencia periódica.** El bucle a 30 Hz simula sobre la
  sala en memoria (sync, sin I/O); la persistencia a DO storage es periódica y al
  vaciarse. Para que los use-cases (que dependen de `IRoomRepository`) operen sobre esa
  sala viva, se inyecta `SingleRoomRepository`; el `DoStorageRoomRepository` solo carga
  al despertar y persiste. Así se honra el hexágono (use-cases vía puerto) sin meter
  I/O en el camino caliente.
- **El bucle llama `step()` directo** (dominio puro), no el use-case `ProcessTick`
  (que hace load/save): el camino caliente debe ser síncrono y sin asignar.
  `ProcessTick` queda como operación transaccional con persistencia (tests/alarms).
- **Wire sobre interfaces estructurales** para evitar el ciclo `@shared`↔`@mecha/sim`.

## 4. Toolchain de tests de DO (Vitest 4 + pool-workers) — resuelto

`@cloudflare/vitest-pool-workers` para Vitest 4 es la línea **0.16.x** (peer `vitest ^4.1`).
Cambió respecto a versiones previas y NO está bien documentado; lo resuelto:
- **No** existe el subpath `@cloudflare/vitest-pool-workers/config` (desapareció
  `defineWorkersConfig`/`defineWorkersProject`).
- Config correcta: `defineConfig` de `vitest/config` + **el plugin `cloudflareTest(opts)`**
  (provee el módulo virtual `cloudflare:test` y el bundling del worker) + **`test.pool =
  cloudflarePool(opts)`** (Vitest 4 eliminó `poolOptions`; las opciones van dentro de
  ambas funciones) + **`vite-tsconfig-paths`** en `plugins` (para resolver `@/@shared/@sim`
  en el bundle del worker). Ver `apps/backend/vitest.workers.config.ts`.
- WebSockets en DO ⇒ `singleWorker: true` + `isolatedStorage: false`.
- En `pnpm-workspace.yaml` el catalog quedó en `@cloudflare/vitest-pool-workers ^0.16.20`.

## 5. Cómo ejecutar

```bash
nvm use && pnpm install
pnpm test               # node: shared(5) + sim(51) + backend use-cases/adapters(20)
pnpm --filter @mecha/backend test:do   # workerd: GameRoomDO (4)
pnpm typecheck && pnpm lint
```

## 6. Verificación (workflow adversarial)

Se verificó con un workflow de **4 lentes en paralelo + síntesis** (DO/netcode,
formato binario, memoria por-tick, hexagonal/persistencia) que LEYÓ el código real, y
luego se ejecutó toda la suite en Node 24.11: **81 tests en verde** (shared 5, sim 51,
backend node 20, **DO en workerd 5**) + typecheck + lint limpios.

**Must-fix encontrado y corregido (bug real de hibernación):**
- `webSocketMessage` no rearrancaba el bucle tras un *wake*: si una sala hiberna y un
  socket preexistente envía input, este se acumulaba en `inbox` y **nunca se simulaba**
  (pérdida silenciosa de input). → Se añadió `ensureLoop()` al inicio de
  `webSocketMessage` (cubre cualquier mensaje que despierte el DO).

**Mejoras aplicadas (claramente correctas):**
- **Aliasing de buffer:** `broadcast()` ahora hace `.slice()` del snapshot codificado
  antes de enviarlo a los sockets → seguro independientemente de la semántica de
  `ws.send` y de la reescritura del buffer pooleado en el próximo tick. Una copia por
  broadcast (~cientos de bytes) es despreciable.
- **Feedback de control:** `handleControl` ahora captura el `Result` de
  `startGame`/`changeColor` y, si falla, envía un frame JSON de error al cliente (ya no
  se silencia).
- **`encodeDelta` en un solo pase:** calcula la firma una vez por jugador (antes dos
  veces); garantiza que la cuenta del header coincide con los jugadores escritos.
- **Robustez del bucle:** guarda `if (!this.loop) return` en `tick()` + nota de la
  suposición de runtime monohilo; KEYFRAME forzado también si cambia el tamaño del roster.
- **Test de regresión nuevo:** integración en workerd que verifica que el bucle 30 Hz
  transmite snapshots binarios por el socket (input→tick→broadcast→wire end-to-end).

**Falsos positivos descartados (verificados trazando el código):** el "count mismatch"
de `encodeDelta` (imposible en isolate monohilo sin `await`), la "saturación de GC" por
el `Map` de baseline (trivial), y las "races" entre `tick` y los handlers (los DO son
monohilo). Endurecimientos diferidos al backlog (§7): validación de `PROTOCOL_VERSION`
en decode, clamp explícito de input/posición (la sim ya re-normaliza y clampa), y
validación de `rngState` en deserialización.

## 7. Pendientes / cara al Paso 4

- **Paso 4 (cliente 3D):** consumir el wire en `useGameSockets` — `decodeSnapshot`,
  predicción local con `step()` (mismo `@mecha/sim`), reconciliación por
  `lastProcessedInput`, interpolación de remotos; escribir el `worldStore`; R3F.
- **Vite 7**: `@tanstack/react-start 1.168` exige Vite ≥7 (tenemos 6) — subir en el Paso 4.
- **Delta por cliente con acks**: hoy el delta es contra la baseline del último
  broadcast (compartida), con keyframes periódicos; un esquema per-cliente con acks
  reduce más el ancho de banda (optimización futura).
- **netId numérico** en el wire en vez de id string (compactación futura).
- **Lag compensation** (rebobinado para hitreg) si se decide favorecer al tirador.
- **ProcessTick vs bucle**: documentado que el bucle usa `step()` directo; revisar si
  `ProcessTick` se usa en alguna ruta (alarms) o se simplifica.
