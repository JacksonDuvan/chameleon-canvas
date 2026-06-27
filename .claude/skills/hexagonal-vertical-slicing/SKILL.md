---
name: hexagonal-vertical-slicing
description: >-
  Disciplina arquitectónica del monorepo del juego (Meccha Chameleon Clone) con
  pnpm workspaces: un núcleo de dominio puro y determinista (matemáticas, reglas y
  estado del juego) totalmente ciego a Hono, WebSockets, Cloudflare, TanStack
  Start o React Three Fiber; rodeado de slices verticales por característica de
  negocio (gameplay, monetization), cada uno con sus capas domain / use-cases /
  infrastructure (puertos y adaptadores). Usa esta skill SIEMPRE que haya que
  decidir dónde va un archivo, crear un package/slice/feature nuevo, conectar el
  transporte (Hono, DO, sockets) con la lógica, o revisar un PR por violaciones de
  capas; y siempre que el dominio importe un framework, transporte o librería de
  render. Impone la regla de dependencias (las flechas apuntan hacia adentro),
  mantiene la simulación determinista y compartible entre backend y frontend, y
  exige el patrón Result (errores como valores, estilo Rust), los principios SOLID
  y la inyección de dependencias por constructor. Aplícala ANTES de crear archivos
  o elegir en qué package vive el código nuevo.
---
 
# Arquitectura Hexagonal + Slicing Vertical (Meccha Chameleon Clone)
 
El requisito más duro de este juego define su arquitectura: **la misma simulación
debe correr en el backend (autoritativo) y en el frontend (predicción)**. Eso solo
es posible si la simulación es *pura y determinista*: sin framework, sin
transporte, sin render, sin reloj de pared, sin `Math.random` sin semilla. Por eso
la arquitectura aquí no es burocracia, es lo que hace posible la predicción del
cliente (ver la skill `authoritative-netcode`).
 
El modelo es **Puertos y Adaptadores** (arquitectura hexagonal de Alistair
Cockburn): el dominio vive en el centro y no depende de nada externo; todo lo
técnico vive en los bordes detrás de interfaces. La organización es por **slices
verticales** (características de negocio), no por capas técnicas. Sobre esa base
imponemos tres convenciones de código transversales: **patrón Result**, **SOLID** e
**inyección de dependencias**.
 
Lee este archivo entero antes de crear un package, slice o feature, o antes de
conectar cualquier transporte con cualquier lógica.
 
## La regla de oro: las dependencias apuntan hacia adentro
 
```
   adaptadores driving           NÚCLEO DE DOMINIO          adaptadores driven
   (llaman al núcleo)          (no depende de nada)       (los llama el núcleo)
 
  entrypoints (Hono/DO) ─▶ ┌────────────────────────┐ ◀─ adapters (DO storage)
  sockets WS            ─▶ │  domain (puro)          │ ◀─ adapters (KV / SDKs)
  input del cliente     ─▶ │  use-cases (aplicación) │ ◀─ broadcaster de snapshots
                           └────────────────────────┘
        el núcleo define PUERTOS (interfaces); los adaptadores los implementan/llaman
```
 
- El **dominio nunca importa un adaptador.** Los adaptadores siempre importan el
  dominio.
- El dominio define **puertos** como interfaces de TypeScript: *puertos de salida*
  (lo que el núcleo necesita del mundo, p. ej. `IMonetizationService`,
  `IRoomRepository`) y *puertos de entrada* (lo que el mundo puede pedirle al
  núcleo, p. ej. los use-cases).
- Los **entrypoints** (`GameRoomDO.ts`, rutas Hono, sockets) son adaptadores
  *driving*: traducen el protocolo y delegan en los use-cases. No contienen
  reglas de juego.
- Una **composition root** (un único punto de cableado: el constructor del DO o
  el `index.ts` de Hono) instancia los adaptadores y los inyecta. Nadie más conoce
  los tipos concretos.
Si el código de `domain/` importa `hono`, `@cloudflare/workers-types`, `three`,
`@tanstack/*` o un SDK de almacenamiento, la arquitectura está rota: detente y
mueve esa responsabilidad a un adaptador.
 
## Estructura del monorepo (pnpm workspaces)
 
```
/packages/shared      # Esquemas de Hono RPC, tipos globales y DTOs de red.
                      # Lo importan backend y frontend. Solo tipos/contratos puros.
/apps/backend         # Node.js + Hono + Cloudflare Durable Objects.
/apps/frontend        # TanStack Start + React Three Fiber + Zustand.
```
 
`/packages/shared` es el contrato de red compartido (los DTOs que viajan por el
WebSocket, los esquemas de Hono RPC, los ids de protocolo). No contiene lógica de
juego: las reglas viven dentro de cada app, en sus slices. Configura las
*project references* / *paths* de TypeScript para que un archivo de `domain/` **no
pueda** importar hacia afuera: un import en dirección equivocada debe romper el
build, no solo la revisión.
 
### Backend — `apps/backend/src/` (slicing vertical + hexagonal)
 
```
apps/backend/src/
├── index.ts                     # Entry de Cloudflare Workers (Hono App)
├── wrangler.json                # Config de Workers, bindings de DO y migraciones
├── shared/                      # Infraestructura global (módulos base, logs, etc.)
└── slices/                      # Capas verticales por característica de negocio
    ├── gameplay/                # Slice principal del juego
    │   ├── domain/              # CAPA DE DOMINIO (pura: sin Hono, sin WebSockets)
    │   │   ├── entities/        # Player.ts, Room.ts, GameMap.ts (coords puras x,y,z)
    │   │   ├── value-objects/   # Position.ts, ColorRGBA.ts
    │   │   └── ports/           # Puertos de salida (p. ej. IMonetizationService.ts)
    │   ├── use-cases/           # CAPA DE APLICACIÓN (orquesta dominio + puertos)
    │   │   ├── ProcessTick.ts   # Ejecuta el bucle físico a 30 Hz
    │   │   ├── ChangeColor.ts   # Procesa la absorción de color de un jugador
    │   │   └── PlayerJoin.ts    # Lógica de entrada a la sala
    │   └── infrastructure/      # CAPA DE INFRAESTRUCTURA (adaptadores)
    │       ├── adapters/        # Implementaciones de los puertos
    │       └── entrypoints/     # Sockets Hono y Durable Objects (GameRoomDO.ts)
    └── monetization/            # Slice de monetización (suscripciones, anuncios)
        ├── domain/              # Puertos de verificación y reglas
        └── infrastructure/      # Adaptadores para SDKs externos / KV Store
```
 
Las tres capas dentro de un slice, de adentro hacia afuera:
 
- **`domain/`** — Entidades, value objects y puertos. Es el interior del hexágono.
  Cero dependencias de frameworks, transporte, render o I/O. Las entidades
  contienen invariantes y comportamiento; los value objects son inmutables
  (`Position`, `ColorRGBA`). Los puertos son interfaces que el dominio *necesita*.
- **`use-cases/`** — La capa de aplicación. Cada use-case es **una** operación de
  negocio (`ProcessTick`, `ChangeColor`, `PlayerJoin`). Orquesta entidades del
  dominio y depende de los puertos por interfaz, nunca de su implementación.
  Devuelve `Result` (ver más abajo), no lanza excepciones.
- **`infrastructure/`** — Los bordes. `adapters/` implementa los puertos (DO
  storage, KV, SDKs); `entrypoints/` recibe el mundo exterior (`GameRoomDO.ts` con
  los handlers de WebSocket Hibernation y el bucle de tick, las rutas Hono) y
  delega en los use-cases.
### Frontend — `apps/frontend/src/` (feature-based)
 
```
apps/frontend/src/
├── routes/                      # Enrutamiento por archivos de TanStack Start
├── shared/                      # UI global: botones, layouts, estilos
└── features/                    # Dominios funcionales del cliente
    ├── canvas-3d/               # FEATURE DEL MUNDO 3D
    │   ├── components/          # Scene.tsx, MechaMesh.tsx, Environment.tsx
    │   ├── hooks/               # useRaycastColor.ts, useInterpolation.ts
    │   └── store/               # worldStore.ts (Zustand Vanilla para la GPU)
    ├── matchmaking/             # FEATURE DE SALAS Y LOBBY
    │   ├── components/          # RoomForm.tsx, PlayerList.tsx
    │   └── hooks/               # useGameSockets.ts
    └── monetization/            # FEATURE DE MONETIZACIÓN
        └── components/          # AdPlaceholder.tsx, CosmeticsShop.tsx
```
 
El frontend se organiza por feature, no por tipo de archivo. Cada feature agrupa
sus `components/`, `hooks/` y (si aplica) su `store/`. El `worldStore.ts` de
`canvas-3d` es un store de **Zustand Vanilla** que vive fuera de React y lo mutan
las capas de red/predicción; la escena lo lee por frame (ver la skill
`r3f-rendering`). `useGameSockets.ts` es el adaptador de transporte del cliente:
abre el WebSocket, predice, reconcilia y escribe en el `worldStore`.
 
`routes/` (TanStack Start, sobre TanStack Router) es solo enrutado y composición de
features; no metas lógica de juego ahí. Las *server functions* de TanStack Start
sirven para trabajo de servidor del propio frontend (auth, SSR), no para la
simulación en tiempo real, que vive en el DO del backend.
 
## Patrón Result: los errores son valores, no excepciones
 
Usamos el patrón `Result` de Rust en todo el dominio y los use-cases para evitar
`try/catch` por todas partes y hacer explícitos los caminos de error en la firma de
cada función. Un use-case **no lanza**: devuelve `Ok` o `Err`.
 
```ts
// packages/shared o domain/shared — el tipo base
export type Result<T, E> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };
 
export const Ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```
 
Los errores de dominio son **tipos**, no strings sueltos ni `Error` genéricos:
 
```ts
// gameplay/domain/errors.ts
export type ChangeColorError =
  | { kind: 'PlayerNotFound'; playerId: string }
  | { kind: 'ColorLocked';    until: number }
  | { kind: 'OutOfBounds';    pos: Position };
```
 
Un use-case devuelve un `Result` y el caller decide qué hacer haciendo
*pattern matching* sobre el discriminante. Sin `try/catch`, sin caminos de error
invisibles:
 
```ts
// gameplay/use-cases/ChangeColor.ts
export class ChangeColor {
  constructor(private readonly rooms: IRoomRepository) {} // DI por constructor
 
  execute(cmd: ChangeColorCmd): Result<Room, ChangeColorError> {
    const player = this.room.players.get(cmd.playerId);
    if (!player) return Err({ kind: 'PlayerNotFound', playerId: cmd.playerId });
    if (player.colorLockedUntil > cmd.tick)
      return Err({ kind: 'ColorLocked', until: player.colorLockedUntil });
 
    player.absorbColor(cmd.color); // muta el dominio, ya validado
    return Ok(this.room);
  }
}
```
 
```ts
// infrastructure/entrypoints/GameRoomDO.ts — el adaptador traduce el Result al transporte
const res = this.changeColor.execute(cmd);
if (!res.ok) {
  switch (res.error.kind) {            // exhaustivo: el compilador obliga a cubrir todos los casos
    case 'PlayerNotFound': return; // ignorar comando inválido
    case 'ColorLocked':    return ws.send(encode({ type: 'REJECTED', until: res.error.until }));
    case 'OutOfBounds':    return ws.send(encode({ type: 'CORRECTION', pos: res.error.pos }));
  }
}
broadcast(res.value);
```
 
Reglas del patrón Result en este repo:
- El dominio y los use-cases **devuelven `Result`**; no lanzan. Lo único que puede
  lanzar es un bug de programación irrecuperable (un `assert` violado), no un error
  de negocio esperado.
- Las excepciones reales (I/O que falla, red caída) se **capturan en el borde**
  (adaptador) y se convierten en `Err(tipoDeDominio)` antes de cruzar hacia
  adentro. El dominio nunca ve un `try/catch`.
- Usa el discriminante (`kind`) y deja que el `switch` exhaustivo te obligue a
  manejar cada caso (apóyate en `never` para el chequeo de exhaustividad).
- Para encadenar operaciones que devuelven `Result` sin anidar `if`s, usa los
  helpers (`map`, `andThen`, `combine`) descritos en
  `references/result-pattern.md`. Puedes usar la librería `neverthrow` si el equipo
  la prefiere; el contrato (Ok/Err como valores) es el mismo.
## SOLID aplicado a este juego
 
- **SRP (responsabilidad única).** Cada use-case tiene **una** razón para cambiar:
  `ProcessTick` solo avanza la física, `ChangeColor` solo resuelve absorción de
  color, `PlayerJoin` solo gestiona la entrada. Si un use-case empieza a hacer dos
  cosas, divídelo.
- **OCP (abierto/cerrado).** Añade comportamiento creando un use-case o un
  adaptador nuevo, no editando el núcleo. Un nuevo modo de juego = un slice nuevo,
  no `if`s repartidos por `ProcessTick`.
- **LSP (sustitución de Liskov).** Cualquier adaptador que implemente un puerto es
  intercambiable: el `IRoomRepository` real sobre DO Storage y el fake en memoria
  de los tests deben ser sustituibles sin que el use-case lo note.
- **ISP (segregación de interfaces).** Puertos pequeños y enfocados:
  `IMonetizationService` con lo justo que el gameplay necesita, no una interfaz
  gigante. El slice de `gameplay` depende de una vista mínima de monetización, no
  de todo su SDK.
- **DIP (inversión de dependencias).** Es el corazón del hexágono: el dominio
  depende de las **interfaces de puerto**, y la infraestructura las implementa. El
  use-case `ChangeColor` conoce `IRoomRepository`, jamás `DoStorageRoomRepository`.
## Inyección de dependencias
 
Usamos **inyección por constructor** con una única composition root. El dominio no
conoce ningún contenedor de DI; recibe sus dependencias (puertos) ya resueltas.
 
```ts
// infrastructure/entrypoints/GameRoomDO.ts — la composition root del slice
export class GameRoomDO extends DurableObject {
  private readonly processTick: ProcessTick;
  private readonly changeColor: ChangeColor;
  private readonly playerJoin: PlayerJoin;
 
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 1) construir adaptadores concretos (driven)
    const rooms: IRoomRepository = new DoStorageRoomRepository(ctx.storage);
    const monet: IMonetizationService = new KvMonetizationAdapter(env.MONET_KV);
    // 2) inyectarlos en los use-cases por constructor
    this.processTick = new ProcessTick(rooms);
    this.changeColor = new ChangeColor(rooms);
    this.playerJoin  = new PlayerJoin(rooms, monet);
  }
}
```
 
Reglas de DI en este repo:
- **Inyección por constructor**, dependiendo siempre de la **interfaz del puerto**,
  nunca de la clase concreta. Esto es DIP en la práctica.
- El **cableado vive solo en la composition root** (constructor del DO / `index.ts`
  de Hono). Ningún use-case hace `new DoStorageRoomRepository(...)`.
- Mantén el constructor del DO **barato**: se vuelve a ejecutar en cada
  *wake* tras hibernar (ver `authoritative-netcode` y la skill de memoria).
- Un contenedor de DI (`awilix`, `tsyringe`) es **opcional** y solo en la capa de
  infraestructura si el cableado crece; nunca lo dejes filtrarse al dominio (nada
  de decoradores `@injectable` sobre entidades puras).
## Pureza Y determinismo del dominio
 
Puro (requisito hexagonal):
- Sin imports de Hono/Express, WebSocket, tipos de Cloudflare, Three.js/WebGL, SDKs
  de almacenamiento ni I/O.
- Sin anotaciones de framework ni DTOs de transporte filtrándose hacia adentro:
  mapea las formas externas a tipos de dominio en el adaptador.
Determinista (requisito de netcode, más estricto que pureza):
- **Sin reloj de pared.** `ProcessTick` avanza por un `dt` fijo inyectado (a 30 Hz,
  `dt = 1/30`), nunca `Date.now()` dentro del step.
- **Sin aleatoriedad ambiente.** Usa un RNG con semilla (puerto o semilla
  inyectada); la semilla del servidor se replica a los clientes.
- **Mismas entradas + mismo estado ⇒ misma salida**, siempre, en backend y
  frontend. Es lo que permite que el cliente prediga y que los tests sean
  reproducibles.
## Testing con fakes, no con infraestructura
 
Como el núcleo solo depende de interfaces, se prueba con fakes en memoria: sin
Cloudflare, sin sockets, sin navegador. Corren en milisegundos.
 
```ts
const rooms = new InMemoryRoomRepository(); // implementa IRoomRepository (LSP)
const changeColor = new ChangeColor(rooms);  // DI: mismo constructor que en prod
 
const res = changeColor.execute({ playerId: 'p1', color: red, tick: 10 });
expect(res.ok).toBe(true);            // los tests afirman sobre el Result, no sobre throws
```
 
El determinismo lo refuerza: alimenta un stream de inputs grabado + semilla y
afirma el estado exacto resultante.
 
## Al decidir dónde va el código nuevo, pregunta en orden
 
1. ¿Es una **regla/estado/matemática de juego**? → `domain/` del slice correcto.
   No puede importar ninguna librería de borde.
2. ¿Es **una operación de negocio** que orquesta el dominio? → un **use-case**
   (uno por operación, SRP). Devuelve `Result`.
3. ¿El núcleo **necesita algo del exterior** (persistencia, monetización, reloj,
   azar)? → define un **puerto** en `domain/ports/` e impleméntalo como **adapter**
   en `infrastructure/adapters/`.
4. ¿Es **cómo el exterior alcanza el núcleo** (handler WS, ruta Hono, DO)? →
   **entrypoint** en `infrastructure/entrypoints/`, que delega en un use-case.
5. ¿Es **cableado** (qué adaptador concreto usar)? → la **composition root**, en
   ningún otro sitio.
6. ¿Es un **contrato compartido** entre backend y frontend (DTO de red, esquema
   Hono RPC)? → `/packages/shared`.
7. ¿Es **render o UI**? → frontend, en la `feature` correspondiente. El render lee
   el `worldStore`, nunca posee el estado de juego (ver `r3f-rendering`).
## Definition of done
 
`domain/` no importa ninguna librería de framework/transporte/render/almacenamiento
y contiene todas las reglas; la simulación es determinista (`dt` inyectado, RNG con
semilla, sin reloj) para que backend y frontend corran el mismo código; el núcleo
habla con el exterior solo por puertos con nombre de dominio; los use-cases son
únicos por operación (SRP) y devuelven `Result` en vez de lanzar; los adaptadores
son finos y sin reglas; el cableado vive solo en la composition root con inyección
por constructor (DIP); el código se agrupa por slice vertical (backend) y por
feature (frontend); y el núcleo está cubierto por tests rápidos con fakes.
 
## Referencia
 
- Alistair Cockburn, *Hexagonal Architecture (Ports & Adapters)* — origen del
  patrón.
- Martin Fowler, Domain-Driven Design / arquitectura:
  https://martinfowler.com/tags/domain%20driven%20design.html
- "Slicing your cake — structuring your hexagons" (slices verticales dentro de un
  hexágono): https://www.qwan.eu/2021/02/15/slicing-your-cake.html
- TanStack Start (overview, server functions, routing):
  https://tanstack.com/start/latest/docs/framework/react/overview
- Helpers y composición del patrón Result: `references/result-pattern.md`