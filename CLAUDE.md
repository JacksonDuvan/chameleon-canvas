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

Las 6 skills viven en `.claude/skills/`. **Cada una se aplica ANTES de escribir el
código que gobierna**, no después. La primera, `mecha-chameleon-gamedesign`, define
**QUÉ** construir (la biblia de mecánicas y UX/UI); las otras cinco definen **CÓMO**
construirlo (arquitectura, netcode, render, memoria, tests). Resumen e índice:

| Skill | Cuándo aplica | Impone |
|---|---|---|
| [`mecha-chameleon-gamedesign`](.claude/skills/mecha-chameleon-gamedesign/SKILL.md) | **Biblia de gameplay/UX-UI.** Implementar/ajustar/revisar cualquier feature de juego: fases (lobby/prep/hunt/results), pintura (Meccha Paint/Spoid/paleta/metallic-roughness), poses, mecánica del Seeker (arma, disparos limitados, tagging, impacto), movimiento, modos (Normal/Infección/Double), mapas, HUD y pantallas, cámara, monetización cosmética; decidir autoritativo vs predicho | **QUÉ** construir para ser fiel al original: reglas del bucle de partida, sistema de pintura y poses, resolución de caza, modos de juego, contratos de las pantallas/HUD. El **CÓMO** se apoya en las otras 5 skills. Aplícala ANTES de diseñar o codificar cualquier feature |
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
- [`docs/04-step-4-client-3d.md`](docs/04-step-4-client-3d.md) — cliente 3D R3F + netcode cliente (predicción/reconciliación/interpolación, InstancedMesh, cuentagotas), Vite 7.
- [`docs/05-step-5-gameplay-ux.md`](docs/05-step-5-gameplay-ux.md) — ciclo jugable + claridad (reinicio de ronda, cámara que sigue, HUD rol/timer) y fix de la sala "envenenada" (renacimiento + reconexión).
- [`docs/06-roadmap.md`](docs/06-roadmap.md) — **roadmap maestro priorizado**: todo lo que falta para el clon completo (P0 núcleo jugable → P4 producción). Léelo para decidir qué desarrollar.
- [`docs/07-librerias-cliente-3d.md`](docs/07-librerias-cliente-3d.md) — **referencia**: librerías del cliente 3D (drei ✅ ya instalada; por qué **NO** `@react-three/rapier`/`cannon`) y el patrón Spoid/camuflaje por raycast (presentación en el cliente vs. autoridad del servidor). Incluye la **decisión** del camuflaje híbrido por fijación.
- [`docs/08-step-6-camouflage-core.md`](docs/08-step-6-camouflage-core.md) — **núcleo jugable P0**: escenario compartido (`@mecha/sim/core/map`), score de camuflaje determinista + barra HUD, y detección del Seeker por **fijación** (wire v2). Cierra P0.1→P0.3.
- [`docs/09-v1-scope.md`](docs/09-v1-scope.md) — **🎯 CHARTER DE V1 (objetivo de lanzamiento)**: qué se lanza (clon *lite* web jugable/divertido/fiel, gráficos low-poly estilizados **secundarios**, pero **esconderse REAL innegociable**). Es el filtro de "¿en qué trabajo?". Léelo antes de elegir tarea.

**Plan por pasos:** Paso 1 ✅ scaffolding · Paso 2 ✅ dominio del backend · Paso 3 ✅
DO + sockets (wire binario) · Paso 4 ✅ cliente 3D R3F + netcode cliente · Paso 5 ✅
ciclo jugable + claridad + robustez de salas · **Paso 6 ✅ núcleo jugable de camuflaje
(P0.1→P0.3: escenario compartido, `camoScore`, detección por fijación) — ver `docs/08`**.
**El núcleo P0 de *Meccha Chameleon* (camuflaje que importa + detección) ya está**, PERO
aún no se puede *esconder de verdad* (escenario plano/abierto, avatar cápsula). **El
objetivo es lanzar una V1**: clon *lite* web jugable/divertido/fiel, gráficos low-poly
estilizados **secundarios**, con **esconderse REAL innegociable**. El corte y la
"definición de done" de V1 están en **[`docs/09-v1-scope.md`](docs/09-v1-scope.md)** (el
backlog completo, en [`docs/06`](docs/06-roadmap.md)).
**Siguiente = núcleo de esconderse de V1:** escenario escondible (props/cobertura) +
poses/rotación + **Seeker en 1ª persona con mouse-look** (acoplados). Luego results/reveal,
matchmaking por código, pass visual, audio y deploy al edge. Al continuar en otra sesión:
lee **`docs/09`** (V1) y `docs/06` (backlog), el `docs/` del paso y la skill relevante.

**Comandos de test:** `pnpm test` (node: shared/sim/backend) · `pnpm --filter @mecha/backend test:do` (DO en workerd) · `pnpm typecheck` · `pnpm lint`.
