# 01 · Paso 1 — Configuración del entorno del monorepo

> Registro de lo construido en el **Paso 1** (scaffolding). Pensado para retomar el
> proyecto en otra sesión con todo el contexto. Estado: **completado.**

## 1. Objetivo del Paso 1

Configurar el entorno del monorepo: Git + `.gitignore`, Node 24, `wrangler` moderno
(Worker + Durable Objects + migraciones) en el backend y adapter de Cloudflare para
TanStack Start en el frontend, y **definir la estructura completa de carpetas**
(Hexagonal + Slicing Vertical) contemplando la separación de la config **WASM
(Rapier)**, los **esquemas compartidos de Hono RPC** y las carpetas del **lienzo 3D**
y el **estado desacoplado**. No se implementa lógica de negocio (eso es Paso 2–4):
los archivos `.ts`/`.tsx` son **stubs autodocumentados** con `TODO(Paso N)` y la skill
que los gobierna.

## 2. Qué se creó (resumen)

- **Git** inicializado (rama `main`) + `.gitignore` robusto para monorepo TS +
  Cloudflare/Vite/Vitest/WASM. (No se hizo commit: pendiente de tu visto bueno.)
- **Node 24**: `.nvmrc` (`24`) + `engines.node >=24` + `engine-strict=true` en `.npmrc`.
- **pnpm workspaces** (`pnpm-workspace.yaml`) con **catalog** de versiones centralizado.
- **TypeScript** base estricto (`tsconfig.base.json`) + tsconfig por workspace con aliases.
- **ESLint flat** (`eslint.config.js`) con `boundaries` + `no-restricted-imports` que
  refuerzan "las flechas apuntan hacia adentro".
- **Backend** (`apps/backend`): `wrangler.jsonc` (Worker + DO `GameRoomDO` con
  `new_sqlite_classes` + KV `MONET_KV` + R2 `COSMETICS_R2`), 2 configs de Vitest, y los
  stubs de slices `gameplay` y `monetization` (domain/use-cases/infrastructure).
- **Frontend** (`apps/frontend`): `vite.config.ts` (plugin de Cloudflare + TanStack
  Start), `wrangler.jsonc` (entry `@tanstack/react-start/server-entry`), y features
  `canvas-3d` / `matchmaking` / `monetization`.
- **Packages**: `@mecha/shared` (Result + protocolo + esquemas RPC) y `@mecha/sim`
  (kernel determinista + físicas Rapier tras puerto + config WASM aislada).
- **Docs** (`docs/00`, `docs/01`) + **`CLAUDE.md`** (índice de las 5 skills + convenciones).

## 3. Decisiones arquitectónicas (importantes para continuar)

### D1 · `packages/sim` — kernel de simulación compartido
Reconcilia `hexagonal-vertical-slicing` ("reglas en los slices") con
`authoritative-netcode` ("comparte la sim vía el package de dominio"). En `@mecha/sim`
va **lo que cliente y servidor deben calcular idéntico** (movimiento, física, RNG con
semilla); en los **slices del backend** va lo **server-only** (fases, roles, victoria,
monetización). Ver `packages/sim/README.md`.

### D2 · Rapier vía `@dimforge/rapier3d-compat`
El build `-compat` **inlinea el WASM en base64** y usa `await RAPIER.init()`: funciona
igual en Workers y navegador desde **un solo paquete**, y **elimina** la necesidad de
`vite-plugin-wasm`/`vite-plugin-top-level-await`. La config WASM queda **aislada** en
`packages/sim/src/physics/wasm/`. Pin **exacto** (sin `^`) por determinismo cross-platform.
> Corrige a la investigación, que sugirió `@dimforge/rapier3d-deterministic` (paquete
> que no existe como tal). Ver `packages/sim/src/physics/wasm/README.md`.

### D3 · "Internal packages" sin build
Los apps **bundlean TS directamente desde `src`** (wrangler/esbuild en backend, Vite en
frontend) usando los aliases. No hay paso `tsc` que emita `.d.ts`/`dist`, ni project
references. `AppType` se importa como **tipo** desde `@mecha/backend` (con
`verbatimModuleSyntax` se borra en runtime; no filtra código de servidor al cliente).
Evita el orden de build y simplifica el DX.

### D4 · Aliases
`@shared/*` → `packages/shared/src/*` · `@sim/*` → `packages/sim/src/*` · `@/*` →
`<app>/src/*` · `@mecha/backend` (workspace, solo tipo) para el `AppType`. Resueltos por
tsconfig `paths` y, en Vite/Vitest, por `vite-tsconfig-paths`.

### D5 · Tick 30 Hz
`wrangler.jsonc` del backend fija `TICK_HZ=30` y el `GameRoomDO` usa `setInterval` a
`1000/30` ms (skill `authoritative-netcode`: 20–30 Hz para proteger la CPU del Worker).
> Corrige a la investigación, que había puesto 60 Hz.

### D6 · Versiones coherentes (correcciones sobre la investigación)
- **React 19 ⇒ R3F v9 + drei v10** (la investigación emparejó React 19 con R3F v8, que
  es de React 18). 
- **Vite 6** (no 5) para casar con `@cloudflare/vite-plugin` 1.x + TanStack Start.
- **pnpm 10** (no 11): es lo instalado en la máquina y soporta catalogs. **Zod 3**
  (conservador, 100% compatible con `@hono/zod-validator`); upgrade a Zod 4 documentado.
- `wrangler` unificado en **v4** (comando `deploy`, `new_sqlite_classes`).
- Se eliminaron campos legacy que la investigación había incluido (`type:"service"`,
  `site.bucket`, `script_name` auto-referenciado, `limits.cpu_ms` dependiente de plan).

## 4. Árbol de directorios (Hexagonal + Slicing Vertical)

```
chameleonCanvas/
├── .gitignore · .gitattributes? · .editorconfig · .prettierrc.json
├── .nvmrc                         # 24
├── .npmrc                         # engine-strict, workspaces, peers
├── package.json                   # raíz: private, engines, scripts, packageManager
├── pnpm-workspace.yaml            # workspaces + catalog (versiones centralizadas)
├── tsconfig.base.json             # opciones estrictas compartidas
├── eslint.config.js               # flat config + boundaries (regla de dependencias)
├── CLAUDE.md                      # índice de skills + convenciones del monorepo
├── docs/
│   ├── 00-initial-prompt.md       # prompt fundacional (verbatim)
│   └── 01-step-1-monorepo-setup.md# este documento
├── .claude/skills/                # las 5 skills (autoridad arquitectónica)
│
├── packages/
│   ├── shared/                    # @mecha/shared — contratos de red (SOLO tipos)
│   │   ├── package.json · tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── result/index.ts    # Result, Ok/Err, map/andThen/combine, assertNever
│   │       ├── protocol/
│   │       │   ├── messages.ts     # ids de mensajes, GamePhase, PlayerRole
│   │       │   └── wire.ts         # *** formato BINARIO del camino caliente ***
│   │       └── rpc/schemas.ts      # *** esquemas Hono RPC compartidos (zod) ***
│   │
│   └── sim/                       # @mecha/sim — kernel DETERMINISTA compartido
│       ├── package.json · tsconfig.json · README.md  (decisión D1)
│       └── src/
│           ├── index.ts
│           ├── core/              # PURO (sin framework/transporte/render)
│           │   ├── value-objects/ # Position.ts, ColorRGBA.ts (forma monomórfica)
│           │   ├── entities/      # WorldState.ts, PlayerState (estado de sim)
│           │   ├── step.ts        # UN tick determinista (server + cliente)
│           │   └── rng.ts         # RNG con semilla
│           └── physics/           # adaptador Rapier tras un PUERTO
│               ├── IPhysicsWorld.ts        # el puerto (core depende de esto)
│               ├── RapierPhysicsWorld.ts   # adaptador
│               └── wasm/          # *** CONFIG WASM (Rapier) AISLADA ***
│                   ├── rapier-init.ts       # await RAPIER.init() (singleton)
│                   └── README.md            # WASM en Worker vs navegador
│
└── apps/
    ├── backend/                   # @mecha/backend — Worker Hono + Durable Objects
    │   ├── package.json · tsconfig.json
    │   ├── wrangler.jsonc         # Worker + DO bindings + migraciones (SQLite) + KV + R2
    │   ├── vitest.config.ts       # domain/use-cases (Node, puro)
    │   ├── vitest.workers.config.ts# infrastructure (pool-workers / workerd)
    │   ├── src/
    │   │   ├── index.ts           # entry Hono + composition root + export AppType + DO
    │   │   ├── shared/env.ts      # tipos de bindings (Env) — `wrangler types` los regenera
    │   │   └── slices/
    │   │       ├── gameplay/
    │   │       │   ├── domain/    # CAPA DOMINIO (pura)
    │   │       │   │   ├── entities/   # Room.ts, Player.ts, GameMap.ts (server-only)
    │   │       │   │   ├── value-objects/index.ts  # re-export de @sim (Position, ColorRGBA)
    │   │       │   │   ├── ports/      # IRoomRepository.ts
    │   │       │   │   └── errors.ts   # uniones discriminadas tipadas
    │   │       │   ├── use-cases/      # ProcessTick.ts (devuelve Result)
    │   │       │   └── infrastructure/
    │   │       │       ├── adapters/   # DoStorageRoomRepository.ts
    │   │       │       └── entrypoints/# GameRoomDO.ts (Hibernation API), routes.ts
    │   │       └── monetization/
    │   │           ├── domain/ports/   # IMonetizationService.ts (puerto en el dominio)
    │   │           └── infrastructure/ # KvMonetizationAdapter.ts, R2CosmeticsAdapter.ts
    │   └── test/
    │       ├── fakes/InMemoryRoomRepository.ts
    │       ├── helpers/result.ts       # expectOk / expectErr
    │       ├── replays/                # fixtures de determinismo (Paso 2)
    │       └── tsconfig.json
    │
    └── frontend/                  # @mecha/frontend — TanStack Start + R3F + Zustand
        ├── package.json · tsconfig.json
        ├── vite.config.ts         # tsconfigPaths + cloudflare + tanstackStart + react
        ├── wrangler.jsonc         # main: @tanstack/react-start/server-entry
        ├── public/models/         # .glb (Draco/Meshopt) — pipeline de assets
        └── src/
            ├── client.ts          # hc<AppType> — Hono RPC tipado end-to-end
            ├── routes/            # enrutado por archivos (__root.tsx, index.tsx)
            ├── shared/            # UI global (components/, styles/globals.css)
            └── features/
                ├── canvas-3d/     # FEATURE DEL MUNDO 3D
                │   ├── components/# Scene.tsx, MechaMesh.tsx, Environment.tsx
                │   ├── hooks/     # useRaycastColor.ts (cuentagotas), useInterpolation.ts
                │   └── store/     # worldStore.ts (*** Zustand vanilla, estado desacoplado ***)
                ├── matchmaking/   # FEATURE DE SALAS / LOBBY
                │   ├── components/# RoomForm.tsx, PlayerList.tsx
                │   └── hooks/     # useGameSockets.ts (transporte + predicción/reconciliación)
                └── monetization/  # FEATURE DE MONETIZACIÓN
                    ├── components/# AdPlaceholder.tsx, CosmeticsShop.tsx
                    └── sdk/index.ts# mocks de CrazyGames/AdSense + Premium Club + cosméticos
```

Las tres separaciones que el prompt pidió explícitamente:
- **Config WASM (Rapier)** → `packages/sim/src/physics/wasm/` (aislada, con su README).
- **Esquemas compartidos de Hono RPC** → `packages/shared/src/rpc/` (+ `protocol/`).
- **Lienzo 3D + estado desacoplado** → `apps/frontend/src/features/canvas-3d/` con
  `store/worldStore.ts` (Zustand vanilla, leído por `useFrame`, fuera de React).

## 5. Mapeo requisito del prompt → dónde vive

| Requisito | Materializado en |
|---|---|
| Hexagonal (puertos/adaptadores) | `slices/*/{domain,infrastructure}`, puertos `I*.ts`, adaptadores en `infrastructure/adapters` |
| Vertical slicing | `apps/backend/src/slices/{gameplay,monetization}` |
| Hono RPC `AppType` | `apps/backend/src/index.ts` (export) → `apps/frontend/src/client.ts` (`hc<AppType>`) |
| Durable Objects | `gameplay/infrastructure/entrypoints/GameRoomDO.ts` + `wrangler.jsonc` (bindings+migraciones) |
| Tick 20–30 Hz | `GameRoomDO` (`setInterval` 1000/30) + `wrangler.jsonc` `TICK_HZ` |
| Rapier WASM determinista | `packages/sim/src/physics/` (puerto+adaptador+wasm) |
| Estado desacoplado de Three.js | `features/canvas-3d/store/worldStore.ts` (Zustand vanilla) |
| Interpolación cliente | `features/canvas-3d/hooks/useInterpolation.ts` |
| Pipeline .glb (Draco/Meshopt) | `apps/frontend/public/models/` + nota en `MechaMesh.tsx` |
| MonetizationService (puerto en dominio) | `slices/monetization/domain/ports/IMonetizationService.ts` |
| SDK mocks (CrazyGames/AdSense, Premium, tienda) | `features/monetization/sdk/index.ts` + componentes |

## 6. Cómo se verificó la config

La sintaxis moderna de wrangler/DO, TanStack Start en CF, Rapier WASM, Hono RPC y
pnpm/Node24 se investigó con un **workflow de 5 frentes en paralelo + síntesis**
contra documentación oficial. Sobre esa síntesis se aplicó **revisión crítica manual**,
que corrigió varios errores (ver D2, D5, D6). Las versiones quedaron en el catalog.

## 7. Puntos a verificar al instalar (⚠ baja confianza)

1. **`compatibility_date`** (`2026-06-01` en ambos workers): confirmar que la versión
   instalada de wrangler/workerd la acepta; ajustar si es necesario.
2. **`@dimforge/rapier3d-compat`**: confirmar la última versión en npm y **fijarla
   exacta** (idéntica en backend y frontend) en el catalog.
3. **Versiones del frontend**: confirmar la matriz React 19 ↔ R3F v9 ↔ drei v10 ↔ three,
   y Vite 6 ↔ `@cloudflare/vite-plugin` ↔ `@tanstack/react-start` al instalar.
4. **`@cloudflare/vitest-pool-workers`**: alinear su versión con Vitest 4.1+.
5. **`@hono/zod-validator` ↔ Zod**: el par fijado asume Zod 3; si se sube a Zod 4, subir
   el validator a la línea compatible.
6. **Node local**: la máquina tenía **Node 20** detectado; con `engine-strict=true`,
   `pnpm install` exigirá **Node 24** (`nvm install 24 && nvm use`).
7. **ESLint boundaries**: validar `pnpm lint` cuando haya código; afinar los `pattern`
   de elementos si algo queda sin clasificar.
8. **WASM en el worker de juego**: confirmar que el bundle embebe el WASM base64 (no fetch
   externo, prohibido en Workers).

## 8. Próximos pasos

- **Paso 2 — Dominio del backend (netcode primero).** Modelar el MVP en coordenadas
  `(x,y,z)`: dos entidades que se mueven/disparan/registran impactos matemáticos.
  Implementar `step`, `rng`, value-objects, `ProcessTick`, transición de fases, y los
  tests de determinismo/replay (skill `tdd-testing`). Empezar por el interior del hexágono.
- **Paso 3 — DO + sockets Hono.** Bucle a 30 Hz, Hibernation API, encode/decode binario,
  persistencia, broadcast de snapshots delta.
- **Paso 4 — Experiencia 3D.** Raycast de color (cuentagotas), absorción de textura,
  predicción/interpolación conectadas al `worldStore`, pipeline `.glb` con `gltfjsx` e
  `InstancedMesh`.
