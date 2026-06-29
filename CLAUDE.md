# CLAUDE.md — Meccha Chameleon Clone

Guía de proyecto para agentes y personas. Léela antes de tocar código. Es el índice
de las **skills** que gobiernan este repo y la fuente de las **convenciones** del
monorepo.

---

## 1. Qué es esto

Clon web 3D online inspirado en el juego viral **"Meccha Chameleon"** (esconderse y
buscar camuflándose en un escenario 3D), desplegable **íntegramente en Cloudflare**.

- **Backend autoritativo:** Hono sobre **Cloudflare Workers** + **Durable Objects**
  (una instancia de DO = una sala) coordinando el estado en tiempo real por WebSockets.
- **Frontend:** **TanStack Start** + **React Three Fiber (R3F)** + **Zustand vanilla**.
- **Monorepo** TypeScript con **pnpm workspaces**.

Reglas de negocio (resumen): rondas en 3 fases **Lobby → Prep → Hunt**; camuflaje por
**cuentagotas** (raycaster que absorbe color/textura del entorno y pinta el avatar);
**poses** y **match de sombras**; **silbidos** opcionales; un Hider atrapado **se
convierte en Seeker**; los Hiders ganan si **sobrevive al menos uno**. Detalle completo
en [`docs/00-initial-prompt.md`](docs/00-initial-prompt.md).

---

## 2. Skills (LÉELAS — son la autoridad arquitectónica)

Las 5 skills viven en `.claude/skills/`. **Cada una se aplica ANTES de escribir el
código que gobierna**, no después. Resumen e índice:

| Skill | Cuándo aplica | Impone |
|---|---|---|
| [`hexagonal-vertical-slicing`](.claude/skills/hexagonal-vertical-slicing/SKILL.md) | Decidir dónde va un archivo; crear package/slice/feature; conectar transporte con lógica; revisar capas | Dominio puro y determinista; puertos y adaptadores; slices verticales; **patrón Result**; SOLID; **DI por constructor**. Ref: [`result-pattern.md`](.claude/skills/hexagonal-vertical-slicing/references/result-pattern.md) |
| [`authoritative-netcode`](.claude/skills/authoritative-netcode/SKILL.md) | Cualquier sincronización multijugador, ticks, snapshots, input, movimiento, impactos, forma de los mensajes WS | Servidor autoritativo; **tick fijo 30 Hz**; predicción + **reconciliación** (sin snap); interpolación de remotos; lag compensation; binario compacto; **WebSocket Hibernation API**. Ref: [`wire-format.md`](.claude/skills/authoritative-netcode/references/wire-format.md) |
| [`r3f-rendering`](.claude/skills/r3f-rendering/SKILL.md) | Escenas 3D, `useFrame`, meshes, materiales, cámara, animación por frame, Zustand que alimenta la escena | **Nunca setState por frame**; mutar refs en `useFrame`; mover con `delta`; no asignar en el bucle; memoizar/compartir geometrías/materiales; **InstancedMesh**; leer estado rápido de Zustand de forma transitoria |
| [`workers-memory-optimization`](.claude/skills/workers-memory-optimization/SKILL.md) | Cualquier camino caliente por-tick/por-frame, bucle de juego, física, serialización | **No asignar en el bucle**; object pooling; pre-asignar buffers/typed arrays; formas de objeto **monomórficas** (hidden classes estables). Límite duro **128 MB**/isolate |
| [`tdd-testing`](.claude/skills/tdd-testing/SKILL.md) | Escribir/modificar/revisar lógica, netcode, adaptadores o lógica de cliente; al pedir una característica nueva | **Test primero** (rojo→verde→refactor); empezar por el interior del hexágono; **fakes, no mocks**; aserciones sobre `Result`; tests de **determinismo/replay**. Ref: [`tooling-setup.md`](.claude/skills/tdd-testing/references/tooling-setup.md) |

> Si vas a escribir código que toque varios de estos temas, lee las skills relevantes
> ENTERAS primero. Las "Definition of done" de cada una son los criterios de revisión.

---

## 3. Layout del monorepo

```
packages/
  shared/   @mecha/shared  — contratos de red: Result, protocolo WS, esquemas RPC (zod). SOLO tipos/contratos.
  sim/      @mecha/sim     — kernel de simulación DETERMINISTA compartido (server+cliente): value-objects,
                            entidades de estado, step a 30 Hz, RNG con semilla, físicas Rapier tras un puerto.
apps/
  backend/  @mecha/backend — Worker Hono + Durable Objects (GameRoomDO). Exporta AppType.
  frontend/ @mecha/frontend— TanStack Start + R3F + Zustand vanilla.
```

- **Backend:** slicing vertical + hexagonal. Cada slice (`gameplay`, `monetization`)
  tiene `domain/` (puro) · `use-cases/` (aplicación, devuelven `Result`) ·
  `infrastructure/` (`adapters/` implementan puertos, `entrypoints/` = `GameRoomDO.ts`
  + rutas Hono). La **composition root** (constructor del DO / `index.ts`) cablea e
  inyecta. Árbol detallado en [`docs/01-step-1-monorepo-setup.md`](docs/01-step-1-monorepo-setup.md).
- **Frontend:** feature-based (`canvas-3d`, `matchmaking`, `monetization`). La UI
  (React) consume lógica solo vía hooks/stores desacoplados de Three.js.

### Decisión clave: `packages/sim`

`hexagonal-vertical-slicing` dice "las reglas viven en los slices"; `authoritative-netcode`
dice "comparte la simulación vía el package de dominio". Se reconcilian así:

- **`@mecha/sim`** = lo que **cliente y servidor deben calcular idéntico** (movimiento,
  física, colisiones, RNG con semilla) → habilita la predicción del cliente.
- **Slices del backend** = lo que **solo el servidor decide** (fases, roles, victoria,
  monetización) → no se predice.

Ver [`packages/sim/README.md`](packages/sim/README.md).

---

## 4. Convenciones de código (NO negociables)

1. **Regla de dependencias hacia adentro.** El dominio/núcleo NUNCA importa Hono,
   `@cloudflare/*`, `three`, `@tanstack/*`, React ni SDKs. Define **puertos** (interfaces);
   los adaptadores los implementan. Reforzado por `eslint.config.js` (boundaries +
   `no-restricted-imports`).
2. **Patrón Result** (`@shared/result`): dominio y use-cases **devuelven `Ok`/`Err`**,
   no lanzan errores de negocio. Errores = uniones discriminadas tipadas. `switch`
   exhaustivo con `assertNever`. `try/catch` solo en adaptadores (convierten a `Err`).
3. **DI por constructor**, dependiendo de la interfaz del puerto. Cableado solo en la
   composition root.
4. **Determinismo del dominio:** `dt` fijo inyectado (1/30), **sin reloj de pared**,
   **RNG con semilla**. Misma entrada + mismo estado ⇒ misma salida, en ambos lados.
5. **Camino caliente sin asignaciones** (por-tick/por-frame): pooling, scratch
   reutilizable, `for` indexado, formas monomórficas.
6. **R3F:** estado de cambio rápido fuera de React (Zustand vanilla `worldStore`),
   mutación de refs en `useFrame`; selectores reactivos solo para estado lento (HUD).
7. **TDD:** el test va primero; fakes en memoria; aserciones sobre `Result`.

### Path aliases

| Alias | Resuelve a | Uso |
|---|---|---|
| `@shared/*` | `packages/shared/src/*` | contratos: `@shared/result`, `@shared/protocol` |
| `@sim/*` | `packages/sim/src/*` | kernel: `@sim/core/...`, `@sim/physics/...` |
| `@/*` | `<app>/src/*` | imports intra-app: `@/slices/...`, `@/features/...` |
| `@mecha/backend` | paquete backend (solo tipo) | `import type { AppType }` en el frontend (Hono RPC) |

---

## 5. Comandos

```bash
# Requisito: Node 24 (usa `nvm use`; .nvmrc lo fija) y pnpm 10+.
pnpm install

pnpm dev               # dev de todos los workspaces en paralelo
pnpm backend:dev       # wrangler dev del Worker de juego
pnpm frontend:dev      # vite dev del cliente

pnpm typecheck         # tsc --noEmit en todos los workspaces
pnpm test              # vitest (dominio + use-cases, puros)
pnpm test:do           # tests de DO/infra (pool-workers, --no-isolate para WS)
pnpm lint              # eslint (incl. reglas de boundaries arquitectónicos)
pnpm format            # prettier

pnpm cf-typegen        # wrangler types -> worker-configuration.d.ts (regenerable)
pnpm backend:deploy / frontend:deploy   # wrangler deploy
```

---

## 6. Stack y versiones

Versiones centralizadas en el **catalog** de `pnpm-workspace.yaml`. Toolchain: TypeScript,
`moduleResolution: bundler`, `strict` + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`.
Físicas: **`@dimforge/rapier3d-compat`** (WASM inline; mismo paquete server+cliente; **pin
exacto** por determinismo). Frontend: **React 19 + R3F v9 + drei v10** (líneas compatibles
con React 19), **Vite 6**, `@cloudflare/vite-plugin`. Tests: Vitest 4.1+ con
`@cloudflare/vitest-pool-workers`. Puntos a verificar al instalar:
[`docs/01-step-1-monorepo-setup.md`](docs/01-step-1-monorepo-setup.md) §"Puntos a verificar".

---

## 7. Estado del proyecto y `docs/`

`docs/` mantiene el contexto entre sesiones (este monorepo se desarrolla por pasos):

- [`docs/00-initial-prompt.md`](docs/00-initial-prompt.md) — prompt fundacional (alcance + reglas).
- [`docs/01-step-1-monorepo-setup.md`](docs/01-step-1-monorepo-setup.md) — qué se construyó en el Paso 1 (scaffolding), decisiones y árbol.
- [`docs/02-step-2-backend-domain.md`](docs/02-step-2-backend-domain.md) — dominio netcode-first (sim determinista + use-cases), garantías de determinismo y verificación.
- [`docs/03-step-3-durable-objects-sockets.md`](docs/03-step-3-durable-objects-sockets.md) — DO + sockets + wire binario (bucle 30 Hz, KEYFRAME/DELTA) y el toolchain de tests de DO (Vitest 4 + pool-workers).

**Plan por pasos:** Paso 1 ✅ scaffolding · Paso 2 ✅ dominio del backend
(netcode-first) · Paso 3 ✅ DO + sockets Hono (Hibernation API, bucle 30 Hz, wire
binario KEYFRAME/DELTA, persistencia periódica; tests de DO en workerd) ·
Paso 4 ⏳ experiencia 3D (consumir el wire: predicción/reconciliación/interpolación,
raycast color, pipeline .glb).
Al continuar en otra sesión: lee `docs/` y la skill relevante, y respeta el plan.

**Comandos de test:** `pnpm test` (node: shared/sim/backend) · `pnpm --filter @mecha/backend test:do` (DO en workerd) · `pnpm typecheck` · `pnpm lint`.
