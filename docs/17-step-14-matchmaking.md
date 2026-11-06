# 17 · Paso 14 — V1-E: matchmaking por código (crear/unirse + roster + pre-flight)

> Épica **V1-E** del charter ([`docs/09`](09-v1-scope.md), backlog P2.1). "Hecho
> cuando": **dos navegadores entran a la misma sala por código (con su nombre) y se
> ven en el lobby** — verificado con E2E headless de 2 clientes (§Verificación).

## Qué se construyó

### 1. Contrato compartido (`@mecha/shared`)

- **`room/`** — código de sala **Crockford base32** (32 símbolos ⇒ 5 bits/byte,
  sin sesgo de módulo; sin letras ambiguas I/L/O/U al dictar/leer de pantalla):
  `roomCodeFromBytes` (determinista; la entropía la inyecta el caller),
  `isValidRoomCode`, `normalizeRoomCode` (limpia espacios/guiones/ambiguos al pegar).
  El contrato vive en shared porque lo usan AMBOS lados: backend genera, frontend
  valida ANTES de abrir el socket (feedback inmediato, biblia UX §Lobby).
- **`rpc/schemas`** — `createRoomSchema` (`hostName` trim 1..24) y
  `roomSummarySchema`, activados en el index de `@mecha/shared`.
  **Desviación consciente**: el scaffold tenía `maxPlayers`/`whistling`; se
  quitaron porque aceptarlos e ignorarlos sería un contrato deshonesto. Vuelven
  cuando exista UI de opciones del lobby (`whistling` llega con V1-H).
- **`protocol/messages`** — `RosterMsg`/`RosterPlayer` (el roster es un mensaje de
  CONTROL: los nombres viven server-side y NO viajan en el wire binario) y
  `RoomStatus` (respuesta del pre-flight).

### 2. Slice backend `matchmaking` (nuevo; hexagonal completo)

```
slices/matchmaking/
├── domain/errors.ts               # MatchmakingError (RegistryError | CodeCollision)
├── domain/ports/IRoomRegistry.ts  # exists/register/list (ISP: solo lo necesario)
├── domain/ports/IRandomSource.ts  # entropía inyectada (el dominio no toca crypto)
├── use-cases/CreateRoom.ts        # genera código único con reintentos (max 8)
├── use-cases/ListRooms.ts         # listado ordenado (más recientes primero)
└── infrastructure/
    ├── adapters/CryptoRandomSource.ts  # crypto.getRandomValues
    ├── adapters/KvRoomRegistry.ts      # KV: TTL 1 h + metadata (list sin N gets)
    └── entrypoints/routes.ts           # Hono RPC encadenado + zValidator
```

- **Crear sala NO materializa el DO**: la sala nace en su Durable Object al primer
  WebSocket (`idFromName(roomId)`). El registro KV existe para LISTAR y
  des-duplicar códigos; su TTL (1 h) solo vence el LISTADO — el código sigue
  siendo válido para unirse mientras el DO viva.
- Composition root en `index.ts`: fábrica perezosa de deps (el `Env` solo existe
  en runtime; objetos triviales en camino frío, una vez por sala).
- El stub `POST /rooms` del slice gameplay se eliminó (superseded).

### 3. Roster en vivo (`GameRoomDO`)

- `broadcastRoster`: difunde `{type:'roster', hostId, players:[{id,name,isHost}]}`
  a todos los sockets en cada **cambio de roster** (join/leave/reconcile con
  cambio). Camino FRÍO (una vez por evento, nunca por tick): JSON de control
  permitido por `authoritative-netcode`. Los nombres no van en el keyframe binario.
- Saneo del nombre en el upgrade WS (trim, 24, vacío→`Player`): misma regla que
  `createRoomSchema` (traducción de protocolo en el adaptador).

### 4. Pre-flight de join (`GET /api/rooms/:roomId/status`)

**Bug detectado al diseñar**: unirse por código a una sala con la ronda empezada
⇒ el DO responde 409 al upgrade ⇒ el cliente NO puede leer ese status (el WS es
opaco) ⇒ **reintento infinito**. Solución: endpoint de estado **read-only** (no
crea la sala; la crea solo el join real):

- Sala en lobby con cupo ⇒ `joinable: true`.
- Sala con 0 jugadores ⇒ `joinable: true` (renace a lobby; ver `reconcileRoster`).
- Ronda en curso ⇒ `joinable: false` (el RoomForm lo dice ANTES de conectar).

### 5. Frontend

- **`RoomForm`** (real, ya no scaffold): nombre + crear + unirse por código con
  normalización al escribir y pre-flight; listado opcional de salas activas.
  Sesión en **sessionStorage** (cada pestaña es un jugador: dos tabs = dos
  jugadores); el nombre se recuerda en localStorage.
- **`PlayerList`**: chips 👑/🦎 con los nombres del lobby (estado lento ⇒ selector
  reactivo seguro).
- **HUD lobby**: código de sala GRANDE y compartible + PlayerList + Salir.
- **`api.ts`**: cliente HTTP tipado con `Result` y validación Zod de respuestas.
  **Deuda resuelta con desviación documentada**: `hc<AppType>` exigía importar el
  grafo de tipos del Worker backend en el programa TS del frontend (aliases `@/`
  colisionan con los propios y arrastran `cloudflare:workers`). El contrato vive
  en los esquemas Zod compartidos (única fuente de verdad); el tipado end-to-end
  por inferencia queda como mejora futura (aísla los aliases o genera .d.ts).
- `useGameSockets`: publica `roomId` al conectar, parsea `roster` (pure
  `parseRoster`), y `resetForNewRoom()` al desmontar (el estado de una sala no se
  filtra a la siguiente).

## TDD y pruebas

Ciclo rojo→verde→refactor en cada capa (interior→exterior). Bugs reales atrapados
por el ciclo: `Ok` sin importar en `ListRooms`, test de colisión que ocupaba un
código distinto al generado, `inputMode` inválido, genéricos de
`KVNamespaceListResult` invertidos, mutación de array durante iteración en el
colector de mensajes del test.

| Suite | Qué cubre |
|---|---|
| shared (25) | contrato del código (determinismo, 0..255, ambiguos, normalización) + esquemas |
| backend node (36) | `CreateRoom` (Ok, colisión+reintento, colisión total, errores KV, **estrés 1000 salas únicas**) + `ListRooms` (**estrés 500**) |
| backend workerd (24) | rutas HTTP con KV real (201/400/listado, **estrés 100 salas**), **CORS preflight (regresión E2E)**, flujo E2E por código, roster (join/leave/host/nombres saneados, **estrés 12 en ráfaga**), **flood 300 inputs** sin matar el bucle, pre-flight (nueva/ocupada/lobby) |
| frontend node (56) | `parseRoster` (defensivo), sesión (roundtrip, corrupta, name), `api.ts` (fakes de fetch: 201/503/network/badbody/zod) |

**Total: 302 tests verdes** + `typecheck` + `lint` en verde.

## Verificación jugable (E2E headless, 2 navegadores)

Resultados del smoke de V1-E (definition of done):

- [x] A crea sala ⇒ código Crockford válido visible en el HUD.
- [x] B se une POR CÓDIGO y ambos se ven en el lobby (PlayerList bidireccional).
- [x] A (host) ve "Empezar"; B ve "esperando al host".
- [x] Código inválido se rechaza en la UI sin salir del formulario.
- [x] Host inicia ⇒ fase `prep` en ambos, 2 jugadores en el mundo de cada uno.

## Bug encontrado por el E2E: CORS

El primer E2E real falló al crear sala: el control HTTP del frontend viaja
cross-origin (dev `:5173` → `:8787`; en prod, dominio propio) y el Worker no
respondía al preflight `OPTIONS` ⇒ el `fetch` del RoomForm moría en silencio
(los WebSockets NO pasan por CORS, por eso el juego en sí funcionaba). Fix:
`cors()` de Hono en `index.ts` (API pública sin cookies ⇒ `*`), con test de
integración del preflight como regresión (`routes.test.ts`).

## Notas de runtime / operación

- **`ROOMS_KV`** añadido a `wrangler.jsonc` con id PLACEHOLDER para dev/tests.
  **Antes del deploy real (V1-I)**: `wrangler kv namespace create ROOMS_KV` y
  sustituir el id (mismo proceso que MONET_KV en su día).
- El listado KV tiene TTL 1 h por sala: una sala que juega más de 1 h sale del
  listado, pero sigue siendo **unible por código** (la verdad vive en el DO).

## Pendiente de V1-E (menores, no bloquean)

- El pre-flight tiene una carrera mínima (sala arranca entre el status y el
  connect ⇒ el 409 caería en el reintento): aceptado para V1; se cierra con un
  `error` de join audible si llega a molestar en el playtest.
- Placas de nombre sobre las cabezas (P2.3): el roster ya entrega los nombres;
  falta render 3D sobre avatares.
